"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import { PeriodPicker, buildPeriod, PeriodKey } from "@/components/PeriodPicker";
import { formatDateTime, formatRub } from "@/lib/format";
import type { DataSource, TransactionType } from "@/lib/types";

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

const SOURCE_LABELS: Record<DataSource, string> = {
  api: "API",
  upload: "Файл",
  manual: "Вручную",
};

const SOURCE_BADGE: Record<DataSource, string> = {
  api: "badge-info",
  upload: "badge-warning",
  manual: "badge-muted",
};

const PAGE_SIZE = 50;

export default function TransactionsPage() {
  const stores = useAppStore((s) => s.stores);
  const transactions = useAppStore((s) => s.transactions);

  const [storeId, setStoreId] = useState<string>("ALL");
  const [periodKey, setPeriodKey] = useState<PeriodKey>("30d");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [sourceFilter, setSourceFilter] = useState<string>("ALL");
  const [page, setPage] = useState(0);

  const period = useMemo(() => buildPeriod(periodKey), [periodKey]);

  const filtered = useMemo(() => {
    const from = new Date(period.from).getTime();
    const to = new Date(period.to).getTime();
    return transactions.filter((t) => {
      if (storeId !== "ALL" && t.storeId !== storeId) return false;
      if (typeFilter !== "ALL" && t.type !== typeFilter) return false;
      if (sourceFilter !== "ALL" && (t.source ?? "manual") !== sourceFilter) return false;
      const d = new Date(t.date).getTime();
      return d >= from && d <= to;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, storeId, typeFilter, sourceFilter, period]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageSlice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function resetPage() { setPage(0); }

  return (
    <div>
      <PageHeader
        title="Транзакции"
        subtitle={`${filtered.length} записей`}
        actions={
          <div className="flex flex-wrap gap-2 items-center">
            <select
              className="input w-auto"
              value={storeId}
              onChange={(e) => { setStoreId(e.target.value); resetPage(); }}
            >
              <option value="ALL">Все магазины</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {s.platform}</option>
              ))}
            </select>
            <select
              className="input w-auto"
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); resetPage(); }}
            >
              <option value="ALL">Все типы</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              className="input w-auto"
              value={sourceFilter}
              onChange={(e) => { setSourceFilter(e.target.value); resetPage(); }}
            >
              <option value="ALL">Все источники</option>
              <option value="api">API</option>
              <option value="upload">Файл</option>
              <option value="manual">Вручную</option>
            </select>
            <PeriodPicker value={periodKey} onChange={(k) => { setPeriodKey(k); resetPage(); }} />
          </div>
        }
      />

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <svg className="w-12 h-12 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            <p className="empty-state-title">Нет транзакций</p>
            <p className="empty-state-desc">Загрузите отчёт или выполните синхронизацию с маркетплейсом.</p>
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
                  <th>SKU</th>
                  <th>Заказ / ID</th>
                  <th className="text-right">Сумма</th>
                  <th>Источник</th>
                  <th>Описание</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageSlice.map((t) => {
                  const store = stores.find((s) => s.id === t.storeId);
                  const src = (t.source ?? "manual") as DataSource;
                  return (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap text-xs text-gray-500">{formatDateTime(t.date)}</td>
                      <td className="text-xs">{store?.name ?? "—"}</td>
                      <td>
                        <span className={
                          t.type === "SALE" ? "badge-success" :
                          t.type === "REFUND" ? "badge-danger" :
                          t.type === "PENALTY" ? "badge-danger" :
                          "badge-muted"
                        }>
                          {TYPE_LABELS[t.type] ?? t.type}
                        </span>
                      </td>
                      <td className="font-mono text-xs">{t.sku ?? "—"}</td>
                      <td className="font-mono text-xs text-gray-500 max-w-[120px] truncate" title={t.orderId}>{t.orderId}</td>
                      <td className={`text-right font-medium ${t.amount >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {formatRub(t.amount)}
                      </td>
                      <td>
                        <span className={SOURCE_BADGE[src]}>
                          {SOURCE_LABELS[src]}
                        </span>
                      </td>
                      <td className="text-xs text-gray-500 max-w-[160px] truncate" title={t.description}>{t.description || "—"}</td>
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
