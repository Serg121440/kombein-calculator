"use client";

import Link from "next/link";
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
} from "@/lib/economics";
import { formatPct, formatRub } from "@/lib/format";
import type { EconomicsModel } from "@/lib/types";

const DEFAULT_REDEMPTION = 70;

export default function EconomicsPage() {
  const products = useAppStore((s) => s.products.filter((p) => p.active));
  const stores = useAppStore((s) => s.stores);
  const tariffs = useAppStore((s) => s.tariffs);
  const transactions = useAppStore((s) => s.transactions);
  const settings = useAppStore((s) => s.settings);

  const [model, setModel] = useState<EconomicsModel>("MODEL1");
  const [schema, setSchema] = useState<"FBO" | "FBS">("FBS");
  const [storeId, setStoreId] = useState("ALL");
  const [periodKey, setPeriodKey] = useState<PeriodKey>("30d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [redemptionPct, setRedemptionPct] = useState(DEFAULT_REDEMPTION);

  const taxRatePct = settings.taxRatePct ?? 0;

  const period = useMemo(
    () => buildPeriod(periodKey, customFrom && customTo ? { from: customFrom, to: customTo } : undefined),
    [periodKey, customFrom, customTo],
  );

  const filtered = useMemo(
    () =>
      storeId === "ALL" ? products : products.filter((p) => p.storeId === storeId),
    [products, storeId],
  );

  const rows = useMemo(
    () =>
      filtered.map((p) => {
        const store = stores.find((s) => s.id === p.storeId);
        const plan = calculatePlan(p, tariffs, { storageDays: settings.storageDays, schema, taxRatePct });

        if (model === "MODEL1") {
          return { product: p, store, plan, perUnit: null, fact: null, deltas: null };
        }

        const fact = calculateFact(p, transactions, period, taxRatePct);
        const perUnit =
          model === "MODEL2"
            ? calculateModel2PerUnit(fact, p.purchasePrice)
            : calculateModel3PerUnit(fact, p.purchasePrice, redemptionPct / 100);
        const deltas = perUnit ? comparePlanFact(plan, perUnit) : null;

        return { product: p, store, plan, fact, perUnit, deltas };
      }),
    [filtered, stores, tariffs, transactions, settings.storageDays, model, period, redemptionPct, schema, taxRatePct],
  );

  const hasData = rows.some((r) =>
    model === "MODEL1" ? true : r.perUnit !== null,
  );

  // Detect FBS logistics warning: FBS schema, no manual logistics tariff, no fbs delivery amount
  const fbsLogisticsWarn = model === "MODEL1" && schema === "FBS";

  return (
    <div>
      <PageHeader
        title="Юнит-экономика"
        subtitle="Сравнительный анализ по всем товарам"
        actions={
          <div className="flex flex-wrap items-center gap-2">
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
            {model !== "MODEL1" && (
              <PeriodPicker
                value={periodKey}
                onChange={setPeriodKey}
                customFrom={customFrom}
                customTo={customTo}
                onCustomChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }}
              />
            )}
            {model === "MODEL1" && (
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
            )}
            <ModelPicker value={model} onChange={setModel} />
          </div>
        }
      />

      {/* FBS logistics hint */}
      {fbsLogisticsWarn && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 flex items-start gap-2">
          <span className="mt-0.5">⚠️</span>
          <span>
            <b>ФБС — логистика не рассчитана.</b> Ozon взимает логистику ФБС за последнюю милю по весовой шкале (~35–1500 ₽/заказ).
            Добавьте тариф типа «Логистика» в разделе{" "}
            <Link href="/tariffs" className="underline font-medium">Тарифы</Link>{" "}
            для точного планирования. В М2/М3 фактические расходы берутся из начислений автоматически.
          </span>
        </div>
      )}

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
            Затраты делятся на {redemptionPct === 0 ? "—" : `продано × ${redemptionPct / 100}`}
          </span>
        </div>
      )}

      {products.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <p className="empty-state-title">Нет активных товаров</p>
            <p className="empty-state-desc">
              Добавьте товары в разделе{" "}
              <Link href="/products" className="text-brand-700 hover:underline">
                Товары
              </Link>{" "}
              или синхронизируйте магазин.
            </p>
          </div>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Товар</th>
                <th>Магазин</th>
                {model === "MODEL1" && (
                  <>
                    <th className="text-right">Цена</th>
                    <th className="text-right">Комиссия</th>
                    <th className="text-right">Логист.</th>
                    <th className="text-right">Хранение</th>
                    <th className="text-right">Себест.</th>
                    {taxRatePct > 0 && <th className="text-right">Налог</th>}
                    <th className="text-right">Прибыль/шт</th>
                    <th className="text-right">Маржа</th>
                    <th className="text-right">ROI</th>
                  </>
                )}
                {model === "MODEL2" && (
                  <>
                    <th className="text-right">Выкупов</th>
                    <th className="text-right">Выручка/шт</th>
                    <th className="text-right">Комисс./шт</th>
                    <th className="text-right">Логист./шт</th>
                    <th className="text-right">Хранение/шт</th>
                    <th className="text-right">Реклама/шт</th>
                    <th className="text-right">Возвр.+Штр./шт</th>
                    {taxRatePct > 0 && <th className="text-right">Налог/шт</th>}
                    <th className="text-right">Себест.</th>
                    <th className="text-right">Прибыль/шт</th>
                    <th className="text-right">Маржа</th>
                    <th className="text-right">ROI</th>
                    <th className="text-right">Δ прибыль</th>
                  </>
                )}
                {model === "MODEL3" && (
                  <>
                    <th className="text-right">Продано</th>
                    <th className="text-right">Выкуп факт</th>
                    <th className="text-right">Выручка/шт</th>
                    <th className="text-right">Комисс./шт</th>
                    <th className="text-right">Логист./шт</th>
                    <th className="text-right">Хранение/шт</th>
                    <th className="text-right">Реклама/шт</th>
                    <th className="text-right">Возвр.+Штр./шт</th>
                    {taxRatePct > 0 && <th className="text-right">Налог/шт</th>}
                    <th className="text-right">Себест.</th>
                    <th className="text-right">Прибыль/шт</th>
                    <th className="text-right">Маржа</th>
                    <th className="text-right">ROI</th>
                    <th className="text-right">Δ прибыль</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ product: p, store, plan, fact, perUnit, deltas }) => {
                const profitClass =
                  model === "MODEL1"
                    ? plan.grossProfit >= 0
                      ? "text-emerald-700 font-medium"
                      : "text-rose-700 font-medium"
                    : perUnit
                      ? perUnit.grossProfit >= 0
                        ? "text-emerald-700 font-medium"
                        : "text-rose-700 font-medium"
                      : "text-gray-400";

                return (
                  <tr key={p.id}>
                    <td>
                      <Link
                        href={`/products/${p.id}`}
                        className="text-brand-700 hover:underline font-medium"
                      >
                        {p.name}
                      </Link>
                      <div className="text-xs text-gray-400">{p.sku}</div>
                    </td>
                    <td className="text-sm text-gray-500">
                      {store?.name ?? "—"}
                    </td>

                    {/* MODEL 1 */}
                    {model === "MODEL1" && (
                      <>
                        <td className="text-right">{formatRub(plan.revenue)}</td>
                        <td className="text-right text-gray-600">{formatRub(plan.commission)}</td>
                        <td className="text-right text-gray-600">
                          {formatRub(plan.logistics)}
                          {schema === "FBS" && plan.logistics === 0 && (
                            <span className="text-amber-500 ml-1" title="Добавьте тариф логистики ФБС">·</span>
                          )}
                        </td>
                        <td className="text-right text-gray-600">{formatRub(plan.storage)}</td>
                        <td className="text-right text-gray-600">{formatRub(plan.costOfGoods)}</td>
                        {taxRatePct > 0 && <td className="text-right text-gray-600">{formatRub(plan.tax)}</td>}
                        <td className={`text-right ${profitClass}`}>{formatRub(plan.grossProfit)}</td>
                        <td className="text-right">{formatPct(plan.marginPct)}</td>
                        <td className="text-right">{formatPct(plan.roiPct)}</td>
                      </>
                    )}

                    {/* MODEL 2 */}
                    {model === "MODEL2" && (
                      <>
                        <td className="text-right">{fact?.unitsRedeemed ?? 0}</td>
                        <td className="text-right">{perUnit ? formatRub(perUnit.revenue) : "—"}</td>
                        <td className="text-right text-gray-600">{perUnit ? formatRub(perUnit.commission) : "—"}</td>
                        <td className="text-right text-gray-600">{perUnit ? formatRub(perUnit.logistics) : "—"}</td>
                        <td className="text-right text-gray-600">{perUnit ? formatRub(perUnit.storage) : "—"}</td>
                        <td className="text-right text-gray-600">{perUnit ? formatRub(perUnit.advertising) : "—"}</td>
                        <td className="text-right text-gray-600">
                          {perUnit ? formatRub(perUnit.penalties + (fact ? (fact.refunds + fact.others) / Math.max(1, fact.unitsRedeemed) : 0)) : "—"}
                        </td>
                        {taxRatePct > 0 && <td className="text-right text-gray-600">{perUnit ? formatRub(perUnit.tax) : "—"}</td>}
                        <td className="text-right text-gray-600">{perUnit ? formatRub(perUnit.costOfGoods) : "—"}</td>
                        <td className={`text-right ${profitClass}`}>{perUnit ? formatRub(perUnit.grossProfit) : "—"}</td>
                        <td className="text-right">{perUnit ? formatPct(perUnit.marginPct) : "—"}</td>
                        <td className="text-right">{perUnit ? formatPct(perUnit.roiPct) : "—"}</td>
                        <td className={`text-right text-sm ${deltas ? deltaClass(deltas.grossProfit) : "text-gray-400"}`}>
                          {deltas ? (deltas.grossProfit > 0 ? "+" : "") + deltas.grossProfit.toFixed(1) + "%" : "—"}
                        </td>
                      </>
                    )}

                    {/* MODEL 3 */}
                    {model === "MODEL3" && (
                      <>
                        <td className="text-right">{fact?.unitsSold ?? 0}</td>
                        <td className="text-right text-xs text-gray-500">
                          {fact ? formatPct(fact.unitsSold > 0 ? (fact.unitsRedeemed / fact.unitsSold) * 100 : 0) : "—"}
                        </td>
                        <td className="text-right">{perUnit ? formatRub(perUnit.revenue) : "—"}</td>
                        <td className="text-right text-gray-600">{perUnit ? formatRub(perUnit.commission) : "—"}</td>
                        <td className="text-right text-gray-600">{perUnit ? formatRub(perUnit.logistics) : "—"}</td>
                        <td className="text-right text-gray-600">{perUnit ? formatRub(perUnit.storage) : "—"}</td>
                        <td className="text-right text-gray-600">{perUnit ? formatRub(perUnit.advertising) : "—"}</td>
                        <td className="text-right text-gray-600">
                          {perUnit ? formatRub(perUnit.penalties + (fact ? (fact.refunds + fact.others) / Math.max(1, fact.unitsSold * redemptionPct / 100) : 0)) : "—"}
                        </td>
                        {taxRatePct > 0 && <td className="text-right text-gray-600">{perUnit ? formatRub(perUnit.tax) : "—"}</td>}
                        <td className="text-right text-gray-600">{perUnit ? formatRub(perUnit.costOfGoods) : "—"}</td>
                        <td className={`text-right ${profitClass}`}>{perUnit ? formatRub(perUnit.grossProfit) : "—"}</td>
                        <td className="text-right">{perUnit ? formatPct(perUnit.marginPct) : "—"}</td>
                        <td className="text-right">{perUnit ? formatPct(perUnit.roiPct) : "—"}</td>
                        <td className={`text-right text-sm ${deltas ? deltaClass(deltas.grossProfit) : "text-gray-400"}`}>
                          {deltas ? (deltas.grossProfit > 0 ? "+" : "") + deltas.grossProfit.toFixed(1) + "%" : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!hasData && model !== "MODEL1" && (
            <div className="py-8 text-center text-sm text-gray-400">
              Нет транзакций за выбранный период — загрузите отчёт или синхронизируйте магазин.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function deltaClass(value: number) {
  if (Math.abs(value) <= 5) return "text-gray-500";
  return value > 0 ? "text-emerald-700" : "text-rose-700";
}
