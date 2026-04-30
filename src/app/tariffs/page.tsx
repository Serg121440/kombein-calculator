"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import { Modal } from "@/components/Modal";
import type { Platform, Tariff, TariffType } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { parseTariffsFile } from "@/lib/import";

const TYPE_LABEL: Record<TariffType, string> = {
  COMMISSION: "Комиссия (%)",
  ACQUIRING: "Эквайринг (%)",
  LOGISTICS: "Логистика (₽)",
  STORAGE: "Хранение (₽/л/сут)",
  LAST_MILE: "Последняя миля (₽)",
};

export default function TariffsPage() {
  const stores = useAppStore((s) => s.stores);
  const tariffs = useAppStore((s) => s.tariffs);
  const addTariff = useAppStore((s) => s.addTariff);
  const updateTariff = useAppStore((s) => s.updateTariff);
  const removeTariff = useAppStore((s) => s.removeTariff);
  const bulkAddTariffs = useAppStore((s) => s.bulkAddTariffs);

  const [tab, setTab] = useState<Platform>("OZON");

  function downloadTemplate(platform: Platform) {
    // Templates mirror the official marketplace commission table formats.
    // Ozon: matches Таблица_категорий_для_расчёта_вознаграждения layout
    const ozonCsv = [
      "Прайс РФ (БЗ),,FBO,,,,,",
      "Категория,Тип товара,до 100 руб.,свыше 100 до 300 руб.,свыше 300 до 1500 руб.,свыше 1500 до 5000 руб.,свыше 5000 до 15000 руб.,свыше 15000 руб.",
      "Электроника,Смартфоны,5.00%,5.00%,5.00%,5.00%,5.00%,5.00%",
      "Одежда и обувь,Верхняя одежда,15.00%,15.00%,15.00%,15.00%,15.00%,15.00%",
      "Красота и здоровье,Уход за лицом,28.00%,28.00%,28.00%,28.00%,28.00%,28.00%",
      "Спорт,Велосипеды,12.00%,12.00%,12.00%,12.00%,12.00%,12.00%",
    ].join("\n");
    // WB: matches сomission.xlsx layout
    const wbCsv = [
      "Категория,Предмет,Склад WB %,Склад продавца - везу на склад WB %,Склад продавца - везу самостоятельно до клиента %",
      "Авто,Авточехлы,29.50,29.50,29.50",
      "Электроника,Смартфоны,10.00,10.00,10.00",
      "Одежда,Платья,20.00,20.00,20.00",
      "Обувь,Кроссовки,20.00,20.00,20.00",
      "Красота,Уход за лицом,25.00,25.00,25.00",
    ].join("\n");
    const csv = platform === "OZON" ? ozonCsv : wbCsv;
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = platform === "OZON" ? "ozon_commission_template.csv" : "wb_commission_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const [editing, setEditing] = useState<Tariff | "new" | null>(null);
  const [form, setForm] = useState({
    storeId: "",
    type: "COMMISSION" as TariffType,
    category: "*",
    value: 0,
    formula: "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: "",
  });

  const [importPreview, setImportPreview] = useState<
    | null
    | {
        rows: Omit<Tariff, "id" | "createdAt">[];
        errors: string[];
        fileName: string;
      }
  >(null);

  const platformStores = stores.filter((s) => s.platform === tab);
  const visibleTariffs = useMemo(
    () =>
      tariffs.filter((t) =>
        platformStores.some((s) => s.id === t.storeId),
      ),
    [tariffs, platformStores],
  );

  function openCreate() {
    setForm({
      storeId: platformStores[0]?.id ?? "",
      type: "COMMISSION",
      category: "*",
      value: 0,
      formula: "",
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveTo: "",
    });
    setEditing("new");
  }

  function openEdit(t: Tariff) {
    setForm({
      storeId: t.storeId,
      type: t.type,
      category: t.category || "*",
      value: t.value,
      formula: t.formula ?? "",
      effectiveFrom: t.effectiveFrom.slice(0, 10),
      effectiveTo: t.effectiveTo?.slice(0, 10) ?? "",
    });
    setEditing(t);
  }

  function submit() {
    if (!form.storeId) return;
    const store = stores.find((s) => s.id === form.storeId);
    if (!store) return;
    const payload: Omit<Tariff, "id" | "createdAt"> = {
      storeId: form.storeId,
      platform: store.platform,
      type: form.type,
      category: form.category || "*",
      value: form.value,
      formula: form.formula || undefined,
      effectiveFrom: new Date(form.effectiveFrom).toISOString(),
      effectiveTo: form.effectiveTo
        ? new Date(form.effectiveTo).toISOString()
        : undefined,
      source: "MANUAL",
    };
    if (editing === "new") {
      addTariff(payload);
    } else if (editing) {
      updateTariff(editing.id, payload);
    }
    setEditing(null);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (platformStores.length === 0) {
      alert("Сначала добавьте магазин на этой платформе");
      return;
    }
    const result = await parseTariffsFile(file, platformStores[0].id, tab);
    setImportPreview({ ...result, fileName: file.name });
    e.target.value = "";
  }

  function confirmImport() {
    if (!importPreview) return;
    bulkAddTariffs(importPreview.rows);
    setImportPreview(null);
  }

  return (
    <div>
      <PageHeader
        title="Тарифы"
        subtitle="Комиссии, логистика, хранение и эквайринг"
        actions={
          <>
            <button
              className="btn-secondary"
              onClick={() => downloadTemplate(tab)}
              title={`Скачать шаблон CSV для ${tab === "OZON" ? "Ozon" : "Wildberries"}`}
            >
              Скачать шаблон
            </button>
            <label className="btn-secondary cursor-pointer">
              Импорт XLSX/CSV
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFile}
              />
            </label>
            <button
              className="btn-primary"
              onClick={openCreate}
              disabled={platformStores.length === 0}
            >
              + Добавить тариф
            </button>
          </>
        }
      />

      <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-white p-1 text-sm">
        {(["OZON", "WB"] as Platform[]).map((p) => (
          <button
            key={p}
            onClick={() => setTab(p)}
            className={
              "px-4 py-1.5 rounded-md " +
              (tab === p
                ? "bg-brand-600 text-white"
                : "text-gray-700 hover:bg-gray-50")
            }
          >
            {p === "OZON" ? "Ozon" : "Wildberries"}
          </button>
        ))}
      </div>

      {visibleTariffs.length === 0 ? (
        <div className="card p-8 text-center text-gray-600">
          Тарифы для платформы не настроены.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Магазин</th>
                <th>Тип</th>
                <th>Категория</th>
                <th className="text-right">Значение</th>
                <th>Формула</th>
                <th>Период</th>
                <th>Источник</th>
                <th className="text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleTariffs.map((t) => {
                const store = stores.find((s) => s.id === t.storeId);
                return (
                  <tr key={t.id}>
                    <td>{store?.name ?? "—"}</td>
                    <td>{TYPE_LABEL[t.type]}</td>
                    <td>{t.category || "*"}</td>
                    <td className="text-right font-mono">{t.value}</td>
                    <td className="text-xs text-gray-500">
                      {t.formula ?? "—"}
                    </td>
                    <td>
                      {formatDate(t.effectiveFrom)}
                      {t.effectiveTo
                        ? ` — ${formatDate(t.effectiveTo)}`
                        : " — ∞"}
                    </td>
                    <td>
                      <span className="badge-muted">{t.source}</span>
                    </td>
                    <td className="text-right">
                      <button
                        className="btn-secondary mr-2"
                        onClick={() => openEdit(t)}
                      >
                        Изменить
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => {
                          if (confirm("Удалить тариф?")) removeTariff(t.id);
                        }}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Добавить тариф" : "Изменить тариф"}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditing(null)}>
              Отмена
            </button>
            <button className="btn-primary" onClick={submit}>
              Сохранить
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <div>
            <label className="label">Магазин</label>
            <select
              className="input"
              value={form.storeId}
              onChange={(e) => setForm({ ...form, storeId: e.target.value })}
            >
              {platformStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Тип</label>
            <select
              className="input"
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as TariffType })
              }
            >
              {(Object.keys(TYPE_LABEL) as TariffType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Категория (или *)</label>
            <input
              className="input"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Значение</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.value}
              onChange={(e) =>
                setForm({ ...form, value: parseFloat(e.target.value) || 0 })
              }
            />
            <p className="text-xs text-gray-500 mt-1">
              {TYPE_LABEL[form.type]}
            </p>
          </div>
          {form.type === "LOGISTICS" && (
            <div>
              <label className="label">
                Формула (напр. weight, volume или пусто)
              </label>
              <input
                className="input"
                value={form.formula}
                onChange={(e) =>
                  setForm({ ...form, formula: e.target.value })
                }
                placeholder="weight"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Действует с</label>
              <input
                className="input"
                type="date"
                value={form.effectiveFrom}
                onChange={(e) =>
                  setForm({ ...form, effectiveFrom: e.target.value })
                }
              />
            </div>
            <div>
              <label className="label">До (опц.)</label>
              <input
                className="input"
                type="date"
                value={form.effectiveTo}
                onChange={(e) =>
                  setForm({ ...form, effectiveTo: e.target.value })
                }
              />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!importPreview}
        onClose={() => setImportPreview(null)}
        title="Предпросмотр импорта тарифов"
        size="lg"
        footer={
          <>
            <button
              className="btn-secondary"
              onClick={() => setImportPreview(null)}
            >
              Отмена
            </button>
            <button
              className="btn-primary"
              onClick={confirmImport}
              disabled={!importPreview?.rows.length}
            >
              Импортировать ({importPreview?.rows.length ?? 0})
            </button>
          </>
        }
      >
        {importPreview && (
          <div>
            <div className="text-sm text-gray-600 mb-2">
              Файл: <span className="font-medium">{importPreview.fileName}</span>
            </div>
            {importPreview.errors.length > 0 && (
              <div className="card p-3 mb-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">
                <div className="font-semibold mb-1">
                  Ошибки ({importPreview.errors.length}):
                </div>
                <ul className="list-disc ml-5 space-y-0.5 max-h-40 overflow-auto">
                  {importPreview.errors.slice(0, 50).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th>Категория</th>
                    <th className="text-right">Значение</th>
                    <th>Формула</th>
                    <th>С</th>
                    <th>По</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.rows.slice(0, 50).map((r, i) => (
                    <tr key={i}>
                      <td>{TYPE_LABEL[r.type]}</td>
                      <td>{r.category}</td>
                      <td className="text-right font-mono">{r.value}</td>
                      <td className="text-xs">{r.formula ?? "—"}</td>
                      <td>{formatDate(r.effectiveFrom)}</td>
                      <td>
                        {r.effectiveTo ? formatDate(r.effectiveTo) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
