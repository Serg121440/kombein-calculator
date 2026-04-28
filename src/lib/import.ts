"use client";

import * as XLSX from "xlsx";
import type {
  Platform,
  Tariff,
  TariffType,
  Transaction,
  TransactionType,
} from "./types";

async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: "array", cellDates: true });
}

function rowsFromSheet(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function normKey(s: string): string {
  return s.toLowerCase().replace(/\s|_|-|\./g, "");
}

function pick(
  row: Record<string, unknown>,
  keys: string[],
): unknown | undefined {
  const map = new Map<string, unknown>();
  for (const k of Object.keys(row)) map.set(normKey(k), row[k]);
  for (const k of keys) {
    const v = map.get(normKey(k));
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

function parseNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return Number(v) || 0;
  const cleaned = v
    .replace(/\s/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) {
      const dt = new Date(
        Date.UTC(d.y, (d.m || 1) - 1, d.d || 1, d.H || 0, d.M || 0, d.S || 0),
      );
      return dt.toISOString();
    }
  }
  if (typeof v === "string" && v.trim()) {
    const isoMatch = v.match(/^\d{4}-\d{2}-\d{2}/);
    if (isoMatch) {
      const dt = new Date(v);
      if (!Number.isNaN(dt.getTime())) return dt.toISOString();
    }
    const ru = v.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (ru) {
      const [, dd, mm, yy] = ru;
      const year = yy.length === 2 ? 2000 + parseInt(yy) : parseInt(yy);
      return new Date(year, parseInt(mm) - 1, parseInt(dd)).toISOString();
    }
  }
  return new Date().toISOString();
}

const TARIFF_TYPE_MAP: Record<string, TariffType> = {
  commission: "COMMISSION",
  комиссия: "COMMISSION",
  acquiring: "ACQUIRING",
  эквайринг: "ACQUIRING",
  logistics: "LOGISTICS",
  логистика: "LOGISTICS",
  storage: "STORAGE",
  хранение: "STORAGE",
  lastmile: "LAST_MILE",
  последняямиля: "LAST_MILE",
};

export async function parseTariffsFile(
  file: File,
  storeId: string,
  platform: Platform,
): Promise<{
  rows: Omit<Tariff, "id" | "createdAt">[];
  errors: string[];
}> {
  const wb = await readWorkbook(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = rowsFromSheet(sheet);
  const errors: string[] = [];
  const rows: Omit<Tariff, "id" | "createdAt">[] = [];

  json.forEach((row, i) => {
    const lineNo = i + 2;
    const typeRaw = String(
      pick(row, ["type", "тип", "категория тарифа"]) ?? "",
    ).toLowerCase();
    const t = TARIFF_TYPE_MAP[normKey(typeRaw)];
    if (!t) {
      errors.push(`Строка ${lineNo}: неизвестный тип "${typeRaw}"`);
      return;
    }
    const category = String(
      pick(row, ["category", "категория"]) ?? "*",
    ).trim() || "*";
    const valueRaw = pick(row, ["value", "значение", "процент", "сумма"]);
    const value = parseNumber(valueRaw);
    if (!Number.isFinite(value)) {
      errors.push(`Строка ${lineNo}: некорректное значение`);
      return;
    }
    const formula = String(pick(row, ["formula", "формула"]) ?? "") || undefined;
    const fromRaw = pick(row, ["from", "с", "effective_from", "effectivefrom"]);
    const toRaw = pick(row, ["to", "по", "effective_to", "effectiveto"]);
    rows.push({
      storeId,
      platform,
      type: t,
      category,
      value,
      formula,
      effectiveFrom: fromRaw
        ? parseDate(fromRaw)
        : new Date(2024, 0, 1).toISOString(),
      effectiveTo: toRaw ? parseDate(toRaw) : undefined,
      source: "FILE",
    });
  });

  return { rows, errors };
}

export type DetectedFormat =
  | "OZON_REALIZATION"
  | "OZON_PAYOUTS"
  | "WB_SALES"
  | "WB_FINANCE"
  | "GENERIC";

function detectFormat(
  headers: string[],
  fileName: string,
): { format: DetectedFormat; platform: Platform } {
  const lower = fileName.toLowerCase();
  const hset = new Set(headers.map(normKey));
  if (hset.has("ozon") || lower.includes("ozon")) {
    if (lower.includes("payout") || lower.includes("выплат"))
      return { format: "OZON_PAYOUTS", platform: "OZON" };
    return { format: "OZON_REALIZATION", platform: "OZON" };
  }
  if (lower.includes("wb") || lower.includes("wildberries")) {
    if (lower.includes("finance") || lower.includes("финанс"))
      return { format: "WB_FINANCE", platform: "WB" };
    return { format: "WB_SALES", platform: "WB" };
  }
  return { format: "GENERIC", platform: "OZON" };
}

const TX_TYPE_MAP: Record<string, TransactionType> = {
  sale: "SALE",
  продажа: "SALE",
  доставленный: "SALE",
  доставлен: "SALE",
  commission: "COMMISSION",
  комиссия: "COMMISSION",
  logistics: "LOGISTICS",
  логистика: "LOGISTICS",
  доставка: "LOGISTICS",
  storage: "STORAGE",
  хранение: "STORAGE",
  penalty: "PENALTY",
  штраф: "PENALTY",
  refund: "REFUND",
  возврат: "REFUND",
  subsidy: "SUBSIDY",
  субсидия: "SUBSIDY",
  компенсация: "SUBSIDY",
  other: "OTHER",
  прочее: "OTHER",
};

function classifyType(raw: string, amount: number): TransactionType {
  const norm = normKey(raw || "");
  for (const [k, v] of Object.entries(TX_TYPE_MAP)) {
    if (norm.includes(normKey(k))) return v;
  }
  // Fallback by sign + keyword
  if (amount >= 0) return "SALE";
  return "OTHER";
}

export async function parseReportFile(
  file: File,
  storeId: string,
): Promise<{
  transactions: Omit<Transaction, "id">[];
  errors: string[];
  format: DetectedFormat;
  platform: Platform;
}> {
  const wb = await readWorkbook(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = rowsFromSheet(sheet);
  const errors: string[] = [];
  const headers = json[0] ? Object.keys(json[0]) : [];
  const detection = detectFormat(headers, file.name);
  const transactions: Omit<Transaction, "id">[] = [];

  json.forEach((row, i) => {
    const lineNo = i + 2;
    const orderId = String(
      pick(row, [
        "order_id",
        "номерзаказа",
        "ordernumber",
        "номерпоставки",
        "srid",
      ]) ?? "",
    ).trim();
    const sku = String(
      pick(row, ["sku", "артикул", "barcode", "штрихкод", "nm_id", "nmid"]) ??
        "",
    ).trim();
    const dateRaw = pick(row, [
      "date",
      "дата",
      "date_from",
      "rr_dt",
      "дата операции",
    ]);
    const amount = parseNumber(
      pick(row, [
        "amount",
        "сумма",
        "к перечислению",
        "ppvz_for_pay",
        "выплата",
      ]),
    );
    const typeRaw = String(
      pick(row, [
        "type",
        "тип",
        "operation",
        "doc_type_name",
        "supplier_oper_name",
        "тип операции",
      ]) ?? "",
    );
    const description = String(
      pick(row, ["description", "описание", "name", "наименование"]) ?? "",
    );

    if (!orderId && !sku) {
      errors.push(`Строка ${lineNo}: отсутствует order_id и SKU — пропуск`);
      return;
    }

    transactions.push({
      storeId,
      sku: sku || undefined,
      orderId: orderId || `ROW-${lineNo}`,
      date: parseDate(dateRaw),
      type: classifyType(typeRaw, amount),
      amount,
      description,
      rawData: row,
      source: "upload",
    });
  });

  return {
    transactions,
    errors,
    format: detection.format,
    platform: detection.platform,
  };
}
