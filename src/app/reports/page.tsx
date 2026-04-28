"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { parseReportFile } from "@/lib/import";
import { formatDateTime } from "@/lib/format";

export default function ReportsPage() {
  const stores = useAppStore((s) => s.stores);
  const reports = useAppStore((s) => s.reports);
  const products = useAppStore((s) => s.products);
  const addReport = useAppStore((s) => s.addReport);
  const removeReport = useAppStore((s) => s.removeReport);
  const addTransactions = useAppStore((s) => s.addTransactions);

  const { success, error: toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedStore, setSelectedStore] = useState(stores[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastResult, setLastResult] = useState<null | {
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
    fileName: string;
  }>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedStore) {
      alert("Сначала выберите магазин");
      return;
    }
    setBusy(true);
    setProgress(20);
    try {
      const parsed = await parseReportFile(file, selectedStore);
      setProgress(60);

      // Map SKU -> productId
      const skuMap = new Map(
        products
          .filter((p) => p.storeId === selectedStore)
          .map((p) => [p.sku.toLowerCase(), p.id]),
      );
      const enriched = parsed.transactions.map((tx) => {
        const sku = tx.sku?.toLowerCase();
        const productId = sku ? skuMap.get(sku) : undefined;
        return { ...tx, productId };
      });

      setProgress(80);
      const { inserted, skipped, updated } = addTransactions(enriched);
      const report = addReport({
        storeId: selectedStore,
        fileName: file.name,
        importedAt: new Date().toISOString(),
        rowsTotal: parsed.transactions.length,
        rowsImported: inserted,
        rowsUpdated: updated,
        rowsSkipped: skipped,
        rowsErrors: parsed.errors.length,
        errors: parsed.errors,
      });
      // Stamp transactions with reportId
      const state = useAppStore.getState();
      const ids = new Set(
        state.transactions
          .slice(state.transactions.length - inserted)
          .map((t) => t.id),
      );
      useAppStore.setState({
        transactions: state.transactions.map((t) =>
          ids.has(t.id) ? { ...t, reportId: report.id } : t,
        ),
      });

      setLastResult({
        inserted,
        updated,
        skipped,
        errors: parsed.errors.length,
        fileName: file.name,
      });
      success(
        `Загружено: ${inserted} новых` +
          (updated > 0 ? `, ${updated} обновлено` : "") +
          (skipped > 0 ? `, ${skipped} дублей` : "") +
          (parsed.errors.length > 0 ? `, ${parsed.errors.length} ошибок` : ""),
      );
      setProgress(100);
      setOpen(false);
    } catch (err) {
      toastError("Ошибка обработки файла: " + (err as Error).message);
    } finally {
      setBusy(false);
      setProgress(0);
      e.target.value = "";
    }
  }

  return (
    <div>
      <PageHeader
        title="Отчёты"
        subtitle="Импорт финансовых отчётов площадок (Excel / CSV)"
        actions={
          <button
            className="btn-primary"
            onClick={() => setOpen(true)}
            disabled={stores.length === 0}
          >
            + Загрузить отчёт
          </button>
        }
      />

      {lastResult && (
        <div className="card p-4 mb-4 border-emerald-200 bg-emerald-50 text-emerald-800 text-sm">
          Загружен файл <b>{lastResult.fileName}</b>:{" "}
          {lastResult.inserted} добавлено
          {lastResult.updated > 0 && ` · ${lastResult.updated} обновлено`}
          {lastResult.skipped > 0 && ` · ${lastResult.skipped} дублей`}
          {lastResult.errors > 0 && ` · ${lastResult.errors} ошибок`}.
        </div>
      )}

      {reports.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <svg className="w-12 h-12 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p className="empty-state-title">Отчёты не загружены</p>
            <p className="empty-state-desc">Загрузите финансовый отчёт из личного кабинета Ozon или Wildberries (Excel / CSV).</p>
            <button className="btn-primary mt-2" onClick={() => setOpen(true)} disabled={stores.length === 0}>
              + Загрузить отчёт
            </button>
          </div>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Файл</th>
                <th>Магазин</th>
                <th>Дата загрузки</th>
                <th className="text-right">Всего</th>
                <th className="text-right">Новых</th>
                <th className="text-right">Обновлено</th>
                <th className="text-right">Дубли</th>
                <th className="text-right">Ошибки</th>
                <th className="text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reports
                .slice()
                .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
                .map((r) => {
                  const store = stores.find((s) => s.id === r.storeId);
                  const isEmpty = r.rowsImported === 0 && r.rowsTotal > 0;
                  return (
                    <tr key={r.id} className={isEmpty ? "bg-amber-50" : ""}>
                      <td className="font-medium">
                        {r.fileName}
                        {isEmpty && (
                          <span className="ml-2 badge-warning text-xs">0 строк — загрузите снова</span>
                        )}
                      </td>
                      <td>{store?.name ?? "—"}</td>
                      <td>{formatDateTime(r.importedAt)}</td>
                      <td className="text-right">{r.rowsTotal}</td>
                      <td className={`text-right font-medium ${isEmpty ? "text-amber-700" : "text-emerald-700"}`}>
                        {r.rowsImported}
                      </td>
                      <td className="text-right text-sky-700">
                        {r.rowsUpdated ?? 0}
                      </td>
                      <td className="text-right">{r.rowsSkipped}</td>
                      <td className="text-right text-rose-700">
                        {r.rowsErrors}
                      </td>
                      <td className="text-right">
                        <div className="flex gap-1 justify-end">
                          {isEmpty && (
                            <button
                              className="btn-primary text-xs"
                              onClick={() => {
                                setSelectedStore(r.storeId);
                                removeReport(r.id);
                                setOpen(true);
                              }}
                            >
                              Загрузить снова
                            </button>
                          )}
                          <button
                            className="btn-danger text-xs"
                            onClick={() => {
                              if (confirm("Удалить отчёт и все его транзакции?")) {
                                removeReport(r.id);
                              }
                            }}
                          >
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Загрузить отчёт"
        footer={
          <button
            className="btn-secondary"
            onClick={() => !busy && setOpen(false)}
            disabled={busy}
          >
            Закрыть
          </button>
        }
      >
        <div className="grid gap-3">
          <div>
            <label className="label">Магазин</label>
            <select
              className="input"
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
              disabled={busy}
            >
              <option value="">— выберите —</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.platform}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Файл (CSV / XLSX)</label>
            <input
              className="input"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={onFile}
              disabled={busy || !selectedStore}
            />
            <p className="text-xs text-gray-500 mt-1">
              Формат определяется автоматически по заголовкам. Поддерживаются
              отчёты Ozon и Wildberries.
            </p>
          </div>
          {busy && (
            <div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-2 bg-brand-600 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Обработка файла…
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
