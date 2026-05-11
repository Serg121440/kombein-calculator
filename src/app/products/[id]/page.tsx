"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import { ModelPicker } from "@/components/ModelPicker";
import { PeriodPicker, buildPeriod, PeriodKey } from "@/components/PeriodPicker";
import {
  calculateFact,
  calculateModel2PerUnit,
  calculateModel3PerUnit,
  calculatePlan,
  comparePlanFact,
  productVolumeLiters,
} from "@/lib/economics";
import { formatPct, formatRub } from "@/lib/format";
import type { EconomicsModel } from "@/lib/types";

const DEFAULT_REDEMPTION = 70;

export default function ProductPage() {
  const params = useParams<{ id: string }>();
  const product = useAppStore((s) =>
    s.products.find((p) => p.id === params.id),
  );
  const tariffs = useAppStore((s) => s.tariffs);
  const transactions = useAppStore((s) => s.transactions);
  const settings = useAppStore((s) => s.settings);
  const stores = useAppStore((s) => s.stores);

  const [model, setModel] = useState<EconomicsModel>("MODEL2");
  const [schema, setSchema] = useState<"FBO" | "FBS">("FBS");
  const [periodKey, setPeriodKey] = useState<PeriodKey>("30d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [redemptionPct, setRedemptionPct] = useState(DEFAULT_REDEMPTION);

  const period = useMemo(
    () => buildPeriod(periodKey, customFrom && customTo ? { from: customFrom, to: customTo } : undefined),
    [periodKey, customFrom, customTo],
  );

  if (!product) {
    return (
      <div className="card p-8 text-center">
        Товар не найден.{" "}
        <Link className="text-brand-700" href="/products">
          К списку
        </Link>
      </div>
    );
  }

  const taxRatePct = settings.taxRatePct ?? 0;
  const store = stores.find((s) => s.id === product.storeId);
  const plan = calculatePlan(product, tariffs, { storageDays: settings.storageDays, schema, taxRatePct });
  const fact = model !== "MODEL1" ? calculateFact(product, transactions, period, taxRatePct) : null;

  const perUnit =
    model === "MODEL2" && fact
      ? calculateModel2PerUnit(fact, product.purchasePrice)
      : model === "MODEL3" && fact
        ? calculateModel3PerUnit(fact, product.purchasePrice, redemptionPct / 100)
        : null;

  const deltas = perUnit ? comparePlanFact(plan, perUnit) : null;

  return (
    <div>
      <PageHeader
        title={product.name}
        subtitle={`SKU ${product.sku} · ${store?.name ?? "—"} · ${store?.platform ?? ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {model !== "MODEL1" && (
              <PeriodPicker
                value={periodKey}
                onChange={setPeriodKey}
                customFrom={customFrom}
                customTo={customTo}
                onCustomChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }}
              />
            )}
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
              <button
                className={`px-3 py-1 rounded-md font-medium transition-colors ${schema === "FBS" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                onClick={() => setSchema("FBS")}
              >
                ФБС
              </button>
              <button
                className={`px-3 py-1 rounded-md font-medium transition-colors ${schema === "FBO" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                onClick={() => setSchema("FBO")}
              >
                ФБО
              </button>
            </div>
            <ModelPicker value={model} onChange={setModel} />
          </div>
        }
      />

      {/* Model 3: redemption rate control */}
      {model === "MODEL3" && (
        <div className="card p-4 mb-4 flex flex-wrap items-center gap-4">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
            % выкупа
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={redemptionPct}
            onChange={(e) => setRedemptionPct(Number(e.target.value))}
            className="flex-1 min-w-[120px] max-w-xs accent-brand-600"
          />
          <span className="text-sm font-semibold text-brand-700 w-12 text-right">
            {redemptionPct}%
          </span>
          <span className="text-xs text-gray-400">
            Затраты ÷ ({fact?.unitsSold ?? 0} продано × {redemptionPct / 100})
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* Params card */}
        <div className="card p-4">
          <div className="text-xs uppercase text-gray-500">Параметры</div>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt>Категория</dt>
              <dd>{product.category || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Цена продажи</dt>
              <dd>{formatRub(product.sellingPrice)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Себестоимость</dt>
              <dd>{formatRub(product.purchasePrice)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Вес</dt>
              <dd>{product.weightKg.toFixed(2)} кг</dd>
            </div>
            <div className="flex justify-between">
              <dt>Объём</dt>
              <dd>{productVolumeLiters(product).toFixed(2)} л</dd>
            </div>
          </dl>
        </div>

        {/* Plan card — always visible */}
        <div className="card p-4">
          <div className="text-xs uppercase text-gray-500 mb-2">
            М1 — план {schema} (на 1 шт)
          </div>
          <dl className="space-y-1 text-sm">
            <SectionLabel label="Продажи" />
            <Row label="Выручка" value={formatRub(plan.revenue)} />
            <Row label="− Комиссия Ozon" value={formatRub(plan.commission)} neg />
            {plan.acquiring > 0 && <Row label="− Эквайринг" value={formatRub(plan.acquiring)} neg />}
            <SectionLabel label="Доставка и хранение" />
            <Row label="− Логистика" value={formatRub(plan.logistics)} neg warn={schema === "FBS" && plan.logistics === 0} />
            {plan.lastMile > 0 && <Row label="− Последняя миля" value={formatRub(plan.lastMile)} neg />}
            <Row label="− Хранение" value={formatRub(plan.storage)} neg />
            {taxRatePct > 0 && (
              <>
                <SectionLabel label={`Налоги (УСН ${taxRatePct}%)`} />
                <Row label="− Налог" value={formatRub(plan.tax)} neg />
              </>
            )}
            <SectionLabel label="Итог" />
            <Row label="− Себестоимость" value={formatRub(plan.costOfGoods)} neg />
            <hr className="my-1 border-gray-200" />
            <Row
              label="Прибыль/шт"
              value={formatRub(plan.grossProfit)}
              strong
              tone={plan.grossProfit >= 0 ? "good" : "bad"}
            />
            <Row label="Маржа" value={formatPct(plan.marginPct)} />
            <Row label="ROI" value={formatPct(plan.roiPct)} />
          </dl>
          {schema === "FBS" && plan.logistics === 0 && (
            <p className="mt-2 text-xs text-amber-600">
              ⚠ Логистика ФБС не рассчитана — добавьте тариф в разделе Тарифы.
            </p>
          )}
        </div>

        {/* Fact card — MODEL2 / MODEL3 */}
        {fact ? (
          <div className="card p-4">
            <div className="text-xs uppercase text-gray-500 mb-2">
              {model === "MODEL2" ? "М2" : "М3"} — факт за {period.label}
            </div>
            <dl className="space-y-1 text-sm">
              <SectionLabel label="Объём продаж" />
              <Row label="Заказано" value={`${fact.unitsSold + (fact.unitsRedeemed > fact.unitsSold ? 0 : fact.unitsSold - fact.unitsRedeemed)} шт`} />
              <Row label="Доставлено" value={`${fact.unitsRedeemed} шт`} />
              <Row label="Возвращено" value={`${fact.unitsSold - fact.unitsRedeemed} шт`} />
              <SectionLabel label="Продажи (итого за период)" />
              <Row label="Выручка" value={formatRub(fact.revenue)} />
              <Row label="− Комиссия Ozon" value={formatRub(fact.commission)} neg />
              {fact.acquiring > 0 && <Row label="− Эквайринг" value={formatRub(fact.acquiring)} neg />}
              <SectionLabel label="Доставка и хранение" />
              <Row label="− Логистика" value={formatRub(fact.logistics)} neg />
              <Row label="− Хранение" value={formatRub(fact.storage)} neg />
              <SectionLabel label="Возвраты и штрафы" />
              <Row label="− Возвраты" value={formatRub(fact.refunds)} neg />
              <Row label="− Штрафы" value={formatRub(fact.penalties)} neg />
              {fact.others > 0 && <Row label="− Прочие расходы" value={formatRub(fact.others)} neg />}
              {fact.advertising > 0 && (
                <>
                  <SectionLabel label="Реклама" />
                  <Row label="− Реклама" value={formatRub(fact.advertising)} neg />
                </>
              )}
              {taxRatePct > 0 && (
                <>
                  <SectionLabel label={`Налоги (УСН ${taxRatePct}%)`} />
                  <Row label="− Налог" value={formatRub(fact.tax)} neg />
                </>
              )}
              <SectionLabel label="Итог" />
              <Row label="− Себестоимость" value={formatRub(fact.costOfGoods)} neg />
              <hr className="my-1 border-gray-200" />
              <Row
                label="Прибыль (период)"
                value={formatRub(fact.grossProfit)}
                strong
                tone={fact.grossProfit >= 0 ? "good" : "bad"}
              />
            </dl>
          </div>
        ) : (
          <div className="card p-4 flex items-center justify-center text-sm text-gray-400">
            М1 — только плановые данные
          </div>
        )}
      </div>

      {/* Per-unit comparison */}
      {perUnit && deltas && (
        <div className="card p-4 mb-4">
          <div className="font-semibold mb-1">
            Сравнение план / {model === "MODEL2" ? "М2" : "М3"} (на 1 шт)
          </div>
          <div className="text-xs text-gray-400 mb-3">
            {model === "MODEL2"
              ? `База: ${perUnit.unitsBase} выкупленных · выкуп ${formatPct(perUnit.redemptionRate * 100)}`
              : `База: ${perUnit.unitsBase.toFixed(1)} эфф. единиц · выкуп ${formatPct(perUnit.redemptionRate * 100)}`}
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Метрика</th>
                  <th className="text-right">План</th>
                  <th className="text-right">Факт / шт</th>
                  <th className="text-right">Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <CompareRow
                  label="Выручка"
                  plan={plan.revenue}
                  fact={perUnit.revenue}
                  delta={deltas.revenue}
                  deltaTone="positiveGood"
                />
                <CompareRow
                  label="Комиссия"
                  plan={plan.commission}
                  fact={perUnit.commission}
                  delta={deltas.commission}
                  deltaTone="positiveBad"
                />
                <CompareRow
                  label="Логистика"
                  plan={plan.logistics}
                  fact={perUnit.logistics}
                  delta={deltas.logistics}
                  deltaTone="positiveBad"
                />
                <CompareRow
                  label="Хранение"
                  plan={plan.storage}
                  fact={perUnit.storage}
                  delta={deltas.storage}
                  deltaTone="positiveBad"
                />
                {perUnit.advertising > 0 && (
                  <CompareRow
                    label="Реклама"
                    plan={0}
                    fact={perUnit.advertising}
                    delta={0}
                    deltaTone="positiveBad"
                  />
                )}
                {taxRatePct > 0 && (
                  <CompareRow
                    label={`Налог (${taxRatePct}%)`}
                    plan={plan.tax}
                    fact={perUnit.tax}
                    delta={deltas.tax ?? 0}
                    deltaTone="positiveBad"
                  />
                )}
                <CompareRow
                  label="Прибыль"
                  plan={plan.grossProfit}
                  fact={perUnit.grossProfit}
                  delta={deltas.grossProfit}
                  deltaTone="positiveGood"
                />
                <tr>
                  <td>Маржа %</td>
                  <td className="text-right">{formatPct(plan.marginPct)}</td>
                  <td className="text-right">{formatPct(perUnit.marginPct)}</td>
                  <td className={"text-right " + deltaTextClass(deltas.marginPct)}>
                    {deltas.marginPct > 0 ? "+" : ""}
                    {deltas.marginPct.toFixed(1)} п.п.
                  </td>
                </tr>
                <tr>
                  <td>ROI %</td>
                  <td className="text-right">{formatPct(plan.roiPct)}</td>
                  <td className="text-right">{formatPct(perUnit.roiPct)}</td>
                  <td className={"text-right " + deltaTextClass(deltas.roiPct)}>
                    {deltas.roiPct > 0 ? "+" : ""}
                    {deltas.roiPct.toFixed(1)} п.п.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {model !== "MODEL1" && !perUnit && fact && (
        <div className="card p-4 text-sm text-gray-500 text-center">
          {model === "MODEL2"
            ? "Нет выкупленных единиц за период — сравнение недоступно"
            : "Нет проданных единиц за период — сравнение недоступно"}
        </div>
      )}

      <div className="mt-4 text-sm">
        <Link href="/products" className="text-brand-700 hover:underline">
          ← К списку товаров
        </Link>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
  neg,
  warn,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "good" | "bad";
  neg?: boolean;
  warn?: boolean;
}) {
  const valueClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-rose-700"
        : neg
          ? "text-gray-700"
          : "text-gray-900";
  return (
    <div className="flex justify-between">
      <dt className={warn ? "text-amber-600" : "text-gray-600"}>{label}{warn ? " ⚠" : ""}</dt>
      <dd className={(strong ? "font-semibold " : "") + valueClass}>
        {neg ? `− ${value}` : value}
      </dd>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="pt-2 pb-0.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
    </div>
  );
}

function CompareRow({
  label,
  plan,
  fact,
  delta,
  deltaTone,
}: {
  label: string;
  plan: number;
  fact: number;
  delta: number;
  deltaTone: "positiveGood" | "positiveBad";
}) {
  let cls = "text-gray-500";
  if (Math.abs(delta) > 5) {
    if (deltaTone === "positiveGood") {
      cls = delta > 0 ? "text-emerald-700" : "text-rose-700";
    } else {
      cls = delta < 0 ? "text-emerald-700" : "text-rose-700";
    }
  }
  return (
    <tr>
      <td>{label}</td>
      <td className="text-right">{formatRub(plan)}</td>
      <td className="text-right">{formatRub(fact)}</td>
      <td className={"text-right " + cls}>
        {delta > 0 ? "+" : ""}
        {delta.toFixed(1)}%
      </td>
    </tr>
  );
}

function deltaTextClass(value: number) {
  if (Math.abs(value) <= 5) return "text-gray-500";
  return value > 0 ? "text-emerald-700" : "text-rose-700";
}
