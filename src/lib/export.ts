"use client";

import * as XLSX from "xlsx";
import type {
  AppSettings,
  Product,
  Tariff,
  Transaction,
} from "./types";
import { calculatePlan } from "./economics";

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportProductsCsv(
  products: Product[],
  tariffs: Tariff[],
  settings: AppSettings,
) {
  const rows = products.map((p) => {
    const plan = calculatePlan(p, tariffs, {
      storageDays: settings.storageDays,
      taxRatePct: settings.taxRatePct ?? 0,
    });
    return {
      SKU: p.sku,
      Название: p.name,
      Категория: p.category,
      "Цена продажи": p.sellingPrice.toFixed(2),
      Себестоимость: p.purchasePrice.toFixed(2),
      Комиссия: plan.commission.toFixed(2),
      Логистика: plan.logistics.toFixed(2),
      Хранение: plan.storage.toFixed(2),
      Эквайринг: plan.acquiring.toFixed(2),
      ...(settings.taxRatePct ? { [`Налог ${settings.taxRatePct}%`]: plan.tax.toFixed(2) } : {}),
      Прибыль: plan.grossProfit.toFixed(2),
      "Маржа %": plan.marginPct.toFixed(1),
      "ROI %": plan.roiPct.toFixed(1),
    };
  });
  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Products");
  const out = XLSX.write(wb, { type: "array", bookType: "csv" });
  const blob = new Blob([out], { type: "text/csv;charset=utf-8" });
  downloadBlob(`kombein-products-${Date.now()}.csv`, blob);
}

export function exportProductsXlsx(
  products: Product[],
  tariffs: Tariff[],
  settings: AppSettings,
) {
  const rows = products.map((p) => {
    const plan = calculatePlan(p, tariffs, {
      storageDays: settings.storageDays,
      taxRatePct: settings.taxRatePct ?? 0,
    });
    return {
      SKU: p.sku,
      Название: p.name,
      Категория: p.category,
      "Цена продажи": p.sellingPrice,
      Себестоимость: p.purchasePrice,
      Комиссия: plan.commission,
      Логистика: plan.logistics,
      Хранение: plan.storage,
      Эквайринг: plan.acquiring,
      ...(settings.taxRatePct ? { [`Налог ${settings.taxRatePct}%`]: plan.tax } : {}),
      Прибыль: plan.grossProfit,
      "Маржа %": plan.marginPct,
      "ROI %": plan.roiPct,
    };
  });
  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Products");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([out], { type: "application/vnd.ms-excel" });
  downloadBlob(`kombein-products-${Date.now()}.xlsx`, blob);
}

export function exportTransactionsXlsx(transactions: Transaction[]) {
  const rows = transactions.map((t) => ({
    Дата: t.date.slice(0, 10),
    Заказ: t.orderId,
    SKU: t.sku ?? "",
    Тип: t.type,
    Сумма: t.amount,
    Описание: t.description ?? "",
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Transactions");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([out], { type: "application/vnd.ms-excel" });
  downloadBlob(`kombein-transactions-${Date.now()}.xlsx`, blob);
}
