"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  aggregateFactByStore,
  calculatePlan,
  totalsByStore,
} from "@/lib/economics";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { PeriodPicker, buildPeriod, PeriodKey } from "@/components/PeriodPicker";
import { formatPct, formatRub } from "@/lib/format";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function DashboardPage() {
  const stores = useAppStore((s) => s.stores);
  const products = useAppStore((s) => s.products);
  const tariffs = useAppStore((s) => s.tariffs);
  const transactions = useAppStore((s) => s.transactions);
  const settings = useAppStore((s) => s.settings);

  const [periodKey, setPeriodKey] = useState<PeriodKey>("30d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [storeId, setStoreId] = useState<string>("ALL");
  const period = useMemo(
    () => buildPeriod(periodKey, customFrom && customTo ? { from: customFrom, to: customTo } : undefined),
    [periodKey, customFrom, customTo],
  );

  const targetStores = useMemo(
    () => (storeId === "ALL" ? stores : stores.filter((s) => s.id === storeId)),
    [stores, storeId],
  );

  const totals = useMemo(() => {
    return targetStores.reduce(
      (acc, s) => {
        const t = totalsByStore(s, products, transactions, period);
        acc.revenue += t.revenue;
        acc.grossProfit += t.grossProfit;
        acc.commission += t.commission;
        acc.logistics += t.logistics;
        acc.storage += t.storage;
        acc.advertising += t.advertising;
        acc.units += t.unitsSold;
        acc.unitsRedeemed += t.unitsRedeemed;
        return acc;
      },
      {
        revenue: 0,
        grossProfit: 0,
        commission: 0,
        logistics: 0,
        storage: 0,
        advertising: 0,
        units: 0,
        unitsRedeemed: 0,
      },
    );
  }, [targetStores, products, transactions, period]);

  const margin = totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : 0;
  const activeProducts = products.filter((p) => p.active).length;

  const productProfits = useMemo(() => {
    const ctx = { storageDays: settings.storageDays };
    return products
      .filter((p) => storeId === "ALL" || p.storeId === storeId)
      .map((p) => {
        const plan = calculatePlan(p, tariffs, ctx, new Date().toISOString());
        const facts = aggregateFactByStore(
          p.storeId,
          [p],
          transactions,
          period,
        );
        const fact = facts[0];
        const profit = fact ? fact.grossProfit : 0;
        return {
          product: p,
          plan,
          fact,
          profit,
          marginPct: plan.marginPct,
        };
      });
  }, [products, tariffs, transactions, period, settings.storageDays, storeId]);

  const negativeMargin = productProfits.filter((p) => p.marginPct < 0).length;

  const top10 = useMemo(
    () =>
      [...productProfits]
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 10)
        .map((p) => ({
          name: p.product.sku,
          profit: Number(p.profit.toFixed(2)),
        })),
    [productProfits],
  );

  // Plan vs Fact monthly chart
  const planVsFact = useMemo(() => {
    const months: Record<
      string,
      { month: string; plan: number; fact: number }
    > = {};
    const monthKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const txs = transactions.filter((t) => {
      if (storeId !== "ALL" && t.storeId !== storeId) return false;
      const d = new Date(t.date).getTime();
      return (
        d >= new Date(period.from).getTime() &&
        d <= new Date(period.to).getTime()
      );
    });
    for (const tx of txs) {
      const k = monthKey(new Date(tx.date));
      if (!months[k]) months[k] = { month: k, plan: 0, fact: 0 };
      if (tx.type === "SALE") months[k].fact += tx.amount;
      else months[k].fact += tx.amount;
    }
    // Plan = sum of selling prices for each sale
    for (const tx of txs) {
      if (tx.type !== "SALE") continue;
      const k = monthKey(new Date(tx.date));
      const product = products.find((p) => p.id === tx.productId);
      if (!product) continue;
      const plan = calculatePlan(product, tariffs, {
        storageDays: settings.storageDays,
      });
      months[k].plan += plan.grossProfit;
    }
    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
  }, [transactions, period, products, tariffs, settings.storageDays, storeId]);

  // Daily revenue / profit chart
  const daily = useMemo(() => {
    const days: Record<
      string,
      { day: string; revenue: number; profit: number }
    > = {};
    for (const tx of transactions) {
      if (storeId !== "ALL" && tx.storeId !== storeId) continue;
      const d = new Date(tx.date);
      if (
        d.getTime() < new Date(period.from).getTime() ||
        d.getTime() > new Date(period.to).getTime()
      )
        continue;
      const k = d.toISOString().slice(0, 10);
      if (!days[k]) days[k] = { day: k, revenue: 0, profit: 0 };
      if (tx.type === "SALE") days[k].revenue += tx.amount;
      days[k].profit += tx.amount;
    }
    // Subtract cost of goods per sale for profit
    for (const tx of transactions) {
      if (tx.type !== "SALE") continue;
      if (storeId !== "ALL" && tx.storeId !== storeId) continue;
      const d = new Date(tx.date);
      if (
        d.getTime() < new Date(period.from).getTime() ||
        d.getTime() > new Date(period.to).getTime()
      )
        continue;
      const product = products.find((p) => p.id === tx.productId);
      if (!product) continue;
      const k = d.toISOString().slice(0, 10);
      days[k].profit -= product.purchasePrice;
    }
    return Object.values(days).sort((a, b) => a.day.localeCompare(b.day));
  }, [transactions, period, products, storeId]);

  if (stores.length === 0) {
    return (
      <div>
        <PageHeader
          title="Дашборд"
          subtitle="Добавьте магазин, чтобы увидеть аналитику"
        />
        <div className="card p-8 text-center text-gray-600">
          У вас пока нет подключённых магазинов.
          <div className="mt-4">
            <a href="/accounts" className="btn-primary">
              Добавить магазин
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Дашборд"
        subtitle="Сводка по магазинам, KPI и динамика"
        actions={
          <>
            <select
              className="input w-auto"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="ALL">Все магазины</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.platform}
                </option>
              ))}
            </select>
            <PeriodPicker
              value={periodKey}
              onChange={setPeriodKey}
              customFrom={customFrom}
              customTo={customTo}
              onCustomChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }}
            />
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <KpiCard label="Выручка" value={formatRub(totals.revenue)} />
        <KpiCard
          label="Прибыль"
          value={formatRub(totals.grossProfit)}
          tone={totals.grossProfit >= 0 ? "good" : "bad"}
        />
        <KpiCard
          label="Маржа"
          value={formatPct(margin)}
          tone={margin >= 15 ? "good" : margin >= 0 ? "warn" : "bad"}
        />
        <KpiCard label="Активных товаров" value={String(activeProducts)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Реклама" value={formatRub(totals.advertising)} tone={totals.advertising > 0 ? "warn" : "default"} />
        <KpiCard
          label="Продано / Выкуплено"
          value={`${totals.units} / ${totals.unitsRedeemed}`}
          tone={totals.units > 0 && totals.unitsRedeemed / totals.units < 0.5 ? "warn" : "default"}
        />
        <KpiCard
          label="Отрицательная маржа"
          value={String(negativeMargin)}
          tone={negativeMargin > 0 ? "bad" : "good"}
        />
        <KpiCard
          label="Логистика + Хранение"
          value={formatRub(totals.logistics + totals.storage)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-semibold">План vs Факт (прибыль по мес.)</div>
          </div>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={planVsFact}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip
                  formatter={(v: number) => formatRub(Number(v))}
                />
                <Legend />
                <Bar dataKey="plan" fill="#3491ff" name="План" />
                <Bar dataKey="fact" fill="#10b981" name="Факт" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-semibold">Динамика</div>
          </div>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip
                  formatter={(v: number) => formatRub(Number(v))}
                />
                <Legend />
                <Line
                  dataKey="revenue"
                  stroke="#1c73f5"
                  name="Выручка"
                  dot={false}
                />
                <Line
                  dataKey="profit"
                  stroke="#16a34a"
                  name="Прибыль"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="mb-3 font-semibold">Топ-10 товаров по прибыли</div>
          <div className="h-80">
            <ResponsiveContainer>
              <BarChart data={top10} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={100} />
                <Tooltip formatter={(v: number) => formatRub(Number(v))} />
                <Bar dataKey="profit" name="Прибыль">
                  {top10.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={entry.profit >= 0 ? "#10b981" : "#ef4444"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-3 font-semibold">Алерты</div>
          {negativeMargin === 0 ? (
            <div className="text-sm text-gray-500">
              Активных алертов нет ✅ Все товары рентабельны.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {productProfits
                .filter((p) => p.marginPct < 0)
                .slice(0, 10)
                .map((p) => (
                  <li key={p.product.id} className="py-2 flex justify-between">
                    <span>
                      <span className="badge-danger mr-2">−</span>
                      {p.product.sku} · {p.product.name}
                    </span>
                    <span className="text-rose-700 font-medium">
                      {formatPct(p.marginPct)}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
