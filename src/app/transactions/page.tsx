"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import { PeriodPicker, buildPeriod, PeriodKey } from "@/components/PeriodPicker";
import { formatDateTime, formatRub } from "@/lib/format";
import type { TransactionType } from "@/lib/types";

const TYPE_LABELS: Record<TransactionType, string> = {
  SALE: "Продажа",
  COMMISSION: "Комиссия",
  LOGISTICS: "Логистика",
  STORAGE: "Хранение",
  PENALTY: "Штраф",
  REFUND: "Возврат",
  ADVERTISING: "Реклама",
  SUBSIDY: "Субсидия",
  OTHER: "Прочее",
};

const PAGE_SIZE = 50;

export default function TransactionsPage() {
  const stores = useAppStore((s) => s.stores);
  const transactions = useAppStore((s) => s.transactions);
  const products = useAppStore((s) => s.products);

  const [storeId, setStoreId] = useState<string>("ALL");
  const [periodKey, setPeriodKey] = useState<PeriodKey>("30d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [page, setPage] = useState(0);

  const period = useMemo(
    () =>
      buildPeriod(
        periodKey,
        customFrom && customTo ? { from: customFrom, to: customTo } : undefined,
      ),
    [periodKey, customFrom, customTo],
  );

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const productByStoreAndSku = useMemo(
    () => new Map(products.map((p) => [p.storeId + "|" + p.sku, p])),
    [products],
  );
  // For returns/refunds that lack a SKU: look up the product via a sale tx
  // sharing the same orderId+storeId.
  const skuByOrderId = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of transactions) {
      if (t.sku && t.orderId) m.set(t.storeId + "|" + t.orderId, t.sku);
    }
    return m;
  }, [transactions]);

  const filtered = useMemo(() => {
    const from = new Date(period.from).getTime();
    const to = new Date(period.to).getTime();
    return transactions
      .filter((t) => {
        if (storeId !== "ALL" && t.storeId !== storeId) return false;
        if (typeFilter !== "ALL" && t.type !== typeFilter) return false;
        const d = new Date(t.date).getTime();
        return d >= from && d <= to;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, storeId, typeFilter, period]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageSlice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function resetPage() {
    setPage(0);
  }

  return (
    <div>
      <PageHeader
        title="Транзакции"
        subtitle={`${filtered.length} записей · ${period.label}`}
        actions={
          <div className="flex flex-wrap gap-2 items-center">
            <select
              className="input w-auto"
              value={storeId}
              onChange={(e) => {
                setStoreId(e.target.value);
                resetPage();
              }}
            >
              <option value="ALL">Все магазины</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.platform}
                </option>
              ))}
            </select>
            <select
              className="input w-auto"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                resetPage();
              }}
            >
              <option value="ALL">Все типы</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <PeriodPicker
              value={periodKey}
              onChange={(k) => {
                setPeriodKey(k);
                resetPage();
              }}
              customFrom={customFrom}
              customTo={customTo}
              onCustomChange={(f, t) => {
                setCustomFrom(f);
                setCustomTo(t);
                resetPage();
              }}
            />
          </div>
        }
      />

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <svg
              className="w-12 h-12 opacity-20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            <p className="empty-state-title">Нет транзакций</p>
            <p className="empty-state-desc">
              Загрузите отчёт или выполните синхронизацию с маркетплейсом.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Магазин</th>
                  <th>Тип</th>
                  <th>Товар</th>
                  <th>Заказ / ID</th>
                  <th className="text-right">Сумма</th>
                  <th>Описание</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageSlice.map((t) => {
                  const store = stores.find((s) => s.id === t.storeId);
                  const effectiveSku =
                    t.sku ??
                    skuByOrderId.get(t.storeId + "|" + t.orderId);
                  const product =
                    (t.productId ? productById.get(t.productId) : undefined) ??
                    (effectiveSku
                      ? productByStoreAndSku.get(t.storeId + "|" + effectiveSku)
                      : undefined);
                  return (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap text-xs text-gray-500">
                        {formatDateTime(t.date)}
                      </td>
                      <td className="text-xs">{store?.name ?? "—"}</td>
                      <td>
                        <span
                          className={
                            t.type === "SALE"
                              ? "badge-success"
                              : t.type === "REFUND" || t.type === "PENALTY"
                                ? "badge-danger"
                                : "badge-muted"
                          }
                        >
                          {TYPE_LABELS[t.type] ?? t.type}
                        </span>
                      </td>
                      <td className="text-xs max-w-[140px]">
                        {product ? (
                          <Link
                            href={`/products/${product.id}`}
                            className="text-brand-700 hover:underline font-mono"
                            title={product.name}
                          >
                            {product.sku}
                          </Link>
                        ) : effectiveSku ? (
                          <span className="font-mono text-gray-400">{effectiveSku}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td
                        className="font-mono text-xs text-gray-500 max-w-[120px] truncate"
                        title={t.orderId}
                      >
                        {t.orderId}
                      </td>
                      <td
                        className={`text-right font-medium ${
                          t.amount >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {formatRub(t.amount)}
                      </td>
                      <td
                        className="text-xs text-gray-500 max-w-[180px] truncate"
                        title={t.description}
                      >
                        {t.description || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-2 mt-4 justify-end">
              <button
                className="btn-secondary text-xs"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Назад
              </button>
              <span className="text-sm text-gray-500">
                {page + 1} / {totalPages}
              </span>
              <button
                className="btn-secondary text-xs"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Вперёд →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
