"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import { PeriodPicker, buildPeriod, PeriodKey } from "@/components/PeriodPicker";
import { totalsByStore } from "@/lib/economics";
import { formatPct, formatRub } from "@/lib/format";
import { exportTransactionsXlsx } from "@/lib/export";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TrendDirection = "good" | "bad" | "neutral";

interface Metric {
  key: string;
  label: string;
  current: number;
  previous: number;
  change: number;
  direction: TrendDirection;
}

function diffPct(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function classify(
  change: number,
  growthIsGood: boolean,
): TrendDirection {
  if (Math.abs(change) <= 5) return "neutral";
  if (change > 0) return growthIsGood ? "good" : "bad";
  return growthIsGood ? "bad" : "good";
}

export default function AnalyticsPage() {
  const stores = useAppStore((s) => s.stores);
  const products = useAppStore((s) => s.products);
  const transactions = useAppStore((s) => s.transactions);

  const [periodKey, setPeriodKey] = useState<PeriodKey>("30d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [storeId, setStoreId] = useState("ALL");

  const period = useMemo(
    () => buildPeriod(periodKey, customFrom && customTo ? { from: customFrom, to: customTo } : undefined),
    [periodKey, customFrom, customTo],
  );

  // Build "previous" period of equal length
  const previousPeriod = useMemo(() => {
    const from = new Date(period.from).getTime();
    const to = new Date(period.to).getTime();
    const span = to - from;
    return {
      from: new Date(from - span).toISOString(),
      to: new Date(from).toISOString(),
    };
  }, [period]);

  const targetStores = useMemo(
    () =>
      storeId === "ALL" ? stores : stores.filter((s) => s.id === storeId),
    [stores, storeId],
  );

  const aggregate = (range: { from: string; to: string }) => {
    return targetStores.reduce(
      (acc, s) => {
        const t = totalsByStore(s, products, transactions, range);
        acc.revenue += t.revenue;
        acc.profit += t.grossProfit;
        acc.commission += t.commission;
        acc.logistics += t.logistics;
        acc.storage += t.storage;
        acc.penalties += t.penalties;
        acc.units += t.unitsSold;
        return acc;
      },
      {
        revenue: 0,
        profit: 0,
        commission: 0,
        logistics: 0,
        storage: 0,
        penalties: 0,
        units: 0,
      },
    );
  };

  const cur = aggregate(period);
  const prev = aggregate(previousPeriod);

  const margin = (a: { revenue: number; profit: number }) =>
    a.revenue > 0 ? (a.profit / a.revenue) * 100 : 0;

  const metrics: Metric[] = [
    {
      key: "revenue",
      label: "Выручка",
      current: cur.revenue,
      previous: prev.revenue,
      change: diffPct(cur.revenue, prev.revenue),
      direction: classify(diffPct(cur.revenue, prev.revenue), true),
    },
    {
      key: "profit",
      label: "Прибыль",
      current: cur.profit,
      previous: prev.profit,
      change: diffPct(cur.profit, prev.profit),
      direction: classify(diffPct(cur.profit, prev.profit), true),
    },
    {
      key: "margin",
      label: "Маржа %",
      current: margin(cur),
      previous: margin(prev),
      change: diffPct(margin(cur), margin(prev)),
      direction: classify(diffPct(margin(cur), margin(prev)), true),
    },
    {
      key: "commission",
      label: "Комиссия",
      current: cur.commission,
      previous: prev.commission,
      change: diffPct(cur.commission, prev.commission),
      direction: classify(diffPct(cur.commission, prev.commission), false),
    },
    {
      key: "logistics",
      label: "Логистика",
      current: cur.logistics,
      previous: prev.logistics,
      change: diffPct(cur.logistics, prev.logistics),
      direction: classify(diffPct(cur.logistics, prev.logistics), false),
    },
    {
      key: "storage",
      label: "Хранение",
      current: cur.storage,
      previous: prev.storage,
      change: diffPct(cur.storage, prev.storage),
      direction: classify(diffPct(cur.storage, prev.storage), false),
    },
    {
      key: "penalties",
      label: "Штрафы",
      current: cur.penalties,
      previous: prev.penalties,
      change: diffPct(cur.penalties, prev.penalties),
      direction: classify(diffPct(cur.penalties, prev.penalties), false),
    },
  ];

  const chartData = metrics
    .filter((m) => m.key !== "margin")
    .map((m) => ({
      name: m.label,
      Текущий: Number(m.current.toFixed(2)),
      Предыдущий: Number(m.previous.toFixed(2)),
    }));

  const filteredTxs = transactions.filter((t) => {
    if (storeId !== "ALL" && t.storeId !== storeId) return false;
    const d = new Date(t.date).getTime();
    return (
      d >= new Date(period.from).getTime() &&
      d <= new Date(period.to).getTime()
    );
  });

  return (
    <div>
      <PageHeader
        title="Аналитика и тренды"
        subtitle="Сравнение текущего периода с предыдущим"
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
            <button
              className="btn-secondary"
              onClick={() => exportTransactionsXlsx(filteredTxs)}
              disabled={filteredTxs.length === 0}
            >
              Экспорт транзакций
            </button>
          </>
        }
      />

      <div className="card overflow-x-auto mb-4">
        <table className="table">
          <thead>
            <tr>
              <th>Метрика</th>
              <th className="text-right">Текущий период</th>
              <th className="text-right">Предыдущий период</th>
              <th className="text-right">Изменение</th>
              <th>Тренд</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {metrics.map((m) => (
              <tr key={m.key}>
                <td className="font-medium">{m.label}</td>
                <td className="text-right">
                  {m.key === "margin"
                    ? formatPct(m.current)
                    : formatRub(m.current)}
                </td>
                <td className="text-right">
                  {m.key === "margin"
                    ? formatPct(m.previous)
                    : formatRub(m.previous)}
                </td>
                <td
                  className={
                    "text-right " +
                    (m.direction === "good"
                      ? "text-emerald-700"
                      : m.direction === "bad"
                        ? "text-rose-700"
                        : "text-amber-700")
                  }
                >
                  {m.change > 0 ? "+" : ""}
                  {m.change.toFixed(1)}%
                </td>
                <td>
                  {m.direction === "good" && (
                    <span className="badge-success">🟢 Хорошо</span>
                  )}
                  {m.direction === "bad" && (
                    <span className="badge-danger">🔴 Плохо</span>
                  )}
                  {m.direction === "neutral" && (
                    <span className="badge-warning">🟡 Стабильно</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-4">
        <div className="font-semibold mb-3">Сравнение по метрикам</div>
        <div className="h-80">
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(v: number) => formatRub(Number(v))} />
              <Legend />
              <Bar dataKey="Предыдущий" fill="#94a3b8" />
              <Bar dataKey="Текущий" fill="#1c73f5" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
