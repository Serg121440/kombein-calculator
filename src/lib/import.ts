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
  const errors: string[] = [];
  const rows: Omit<Tariff, "id" | "createdAt">[] = [];
  const effectiveFrom = new Date(new Date().getFullYear(), 0, 1).toISOString();

  // Read as raw arrays for multi-header format detection
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  });
  if (rawRows.length === 0) return { rows, errors };

  // Strip percent sign and parse; handles "43.00%", "29,50", 12
  function pctVal(v: unknown): number {
    if (typeof v === "number") return v;
    const s = String(v ?? "")
      .replace(/\s/g, "")
      .replace(",", ".")
      .replace(/%$/, "");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  const h0 = rawRows[0].map((c) => normKey(String(c ?? "")));
  const h1 = rawRows.length > 1 ? rawRows[1].map((c) => normKey(String(c ?? ""))) : [];

  // ── Ozon official commission table (2-row merged header) ─────────────────
  // Row 0: "Прайс РФ (БЗ)" | "" | "FBO" | "" | "" | ...
  // Row 1: "Категория" | "Тип товара" | "до 100 руб." | "свыше 100 до 300 руб." | "свыше 300 до 1500 руб." | ...
  // Data: "Электроника" | "Смартфоны" | "43.00%" | ...
  if (h0.some((h) => h === "fbo" || h.includes("fbo")) && h1.includes("типтовара")) {
    const headers = rawRows[1].map((c) => String(c ?? ""));
    const catIdx = headers.findIndex((h) => normKey(h) === "типтовара");
    // First "свыше 300 до 1500" column belongs to FBO (before FBO Fresh, FBS, RFBS tiers)
    const commIdx = headers.findIndex((h) => {
      const n = normKey(h);
      return n.includes("300") && n.includes("1500");
    });
    const ci = commIdx >= 0 ? commIdx : Math.max(catIdx + 1, 2);

    for (let i = 2; i < rawRows.length; i++) {
      const r = rawRows[i];
      const category = String(r[catIdx] ?? "").trim();
      if (!category || category === "Тип товара") continue;
      const value = pctVal(r[ci]);
      rows.push({
        storeId, platform, type: "COMMISSION",
        category, value, effectiveFrom, source: "FILE",
      });
    }
    return { rows, errors };
  }

  // ── WB official commission table (1-row header) ───────────────────────────
  // Row 0: "Категория" | "Предмет" | "Склад WB, %" | "Склад продавца ..." | ...
  // Data: "Авто" | "Авточехлы" | 29.5 | ...
  if (
    h0.includes("предмет") &&
    h0.some((h) => h.includes("складwb") && !h.includes("продавца"))
  ) {
    const headers = rawRows[0].map((c) => String(c ?? ""));
    const subjectIdx = headers.findIndex((h) => normKey(h) === "предмет");
    const wbIdx = headers.findIndex((h) => {
      const n = normKey(h);
      return n.includes("складwb") && !n.includes("продавца");
    });
    const ci = wbIdx >= 0 ? wbIdx : subjectIdx + 1;

    for (let i = 1; i < rawRows.length; i++) {
      const r = rawRows[i];
      const category = String(r[subjectIdx] ?? "").trim();
      if (!category) continue;
      const value = pctVal(r[ci]);
      rows.push({
        storeId, platform, type: "COMMISSION",
        category, value, effectiveFrom, source: "FILE",
      });
    }
    return { rows, errors };
  }

  // ── Generic / user template format ───────────────────────────────────────
  const json = rowsFromSheet(sheet);
  if (json.length === 0) return { rows, errors };

  const headers = Object.keys(json[0]);
  const hset = new Set(headers.map(normKey));

  // Multi-column template: one row per category, columns = commission, logistics, storage, …
  const hasMultiCol =
    (hset.has("комиссия") ||
      hset.has("комиссия%") ||
      hset.has("ставкакомиссии") ||
      hset.has("комиссиявпроцентах")) &&
    (hset.has("логистика") ||
      hset.has("стоимостьлогистики") ||
      hset.has("доставка") ||
      hset.has("логистикафбо") ||
      hset.has("услугипологистике"));

  if (hasMultiCol) {
    json.forEach((row, i) => {
      const lineNo = i + 2;
      const category = String(
        pick(row, [
          "category", "категория", "наименованиекатегории",
          "предмет", "категориятоваров", "name",
        ]) ?? "",
      ).trim() || "*";

      const commRaw = pick(row, [
        "комиссия", "комиссия%", "ставкакомиссии", "commission",
        "комиссиявпроцентах", "ставкакомиссии%",
      ]);
      const logRaw = pick(row, [
        "логистика", "логистикафбо", "стоимостьлогистики",
        "доставка", "услугипологистике", "logistics",
      ]);
      const storRaw = pick(row, ["хранение", "storage", "хранениефбо"]);
      const lastMileRaw = pick(row, ["последняямиля", "lastmile", "последняямиля₽"]);
      const acquiringRaw = pick(row, ["эквайринг", "acquiring"]);

      let added = 0;
      if (commRaw !== undefined && commRaw !== "") {
        rows.push({ storeId, platform, type: "COMMISSION", category, value: parseNumber(commRaw), effectiveFrom, source: "FILE" });
        added++;
      }
      if (logRaw !== undefined && logRaw !== "") {
        const v = parseNumber(logRaw);
        if (v > 0) { rows.push({ storeId, platform, type: "LOGISTICS", category, value: v, effectiveFrom, source: "FILE" }); added++; }
      }
      if (storRaw !== undefined && storRaw !== "") {
        const v = parseNumber(storRaw);
        if (v > 0) { rows.push({ storeId, platform, type: "STORAGE", category, value: v, effectiveFrom, source: "FILE" }); added++; }
      }
      if (lastMileRaw !== undefined && lastMileRaw !== "") {
        const v = parseNumber(lastMileRaw);
        if (v > 0) { rows.push({ storeId, platform, type: "LAST_MILE", category, value: v, effectiveFrom, source: "FILE" }); added++; }
      }
      if (acquiringRaw !== undefined && acquiringRaw !== "") {
        const v = parseNumber(acquiringRaw);
        if (v > 0) { rows.push({ storeId, platform, type: "ACQUIRING", category, value: v, effectiveFrom, source: "FILE" }); added++; }
      }
      if (added === 0) errors.push(`Строка ${lineNo}: нет распознанных значений`);
    });
  } else {
    // Single-row mode: each row has explicit "type" column
    json.forEach((row, i) => {
      const lineNo = i + 2;
      const typeRaw = String(pick(row, ["type", "тип", "категория тарифа"]) ?? "").toLowerCase();
      const t = TARIFF_TYPE_MAP[normKey(typeRaw)];
      if (!t) {
        errors.push(`Строка ${lineNo}: неизвестный тип "${typeRaw}"`);
        return;
      }
      const category = String(pick(row, ["category", "категория"]) ?? "*").trim() || "*";
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
        storeId, platform, type: t, category, value, formula,
        effectiveFrom: fromRaw ? parseDate(fromRaw) : effectiveFrom,
        effectiveTo: toRaw ? parseDate(toRaw) : undefined,
        source: "FILE",
      });
    });
  }

  return { rows, errors };
}

/** Parse a cost/category import file (CSV or XLSX).
 *  Expected columns: SKU (required), Себестоимость (required), Категория (optional).
 */
export async function parseCostFile(file: File): Promise<{
  rows: Array<{ sku: string; purchasePrice: number; category?: string }>;
  errors: string[];
}> {
  const wb = await readWorkbook(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = rowsFromSheet(sheet);
  const errors: string[] = [];
  const rows: Array<{ sku: string; purchasePrice: number; category?: string }> = [];

  json.forEach((row, i) => {
    const lineNo = i + 2;
    const sku = String(
      pick(row, [
        "sku", "артикул", "offer_id", "offerid",
        "vendor_code", "vendorcode", "артикулпродавца",
      ]) ?? "",
    ).trim();
    if (!sku) {
      errors.push(`Строка ${lineNo}: нет SKU — пропуск`);
      return;
    }
    const priceRaw = pick(row, [
      "purchaseprice", "себестоимость", "cost", "закупочнаяцена",
      "ценазакупки", "purchase_price", "costprice",
    ]);
    const purchasePrice = parseNumber(priceRaw);
    const category =
      String(pick(row, ["category", "категория"]) ?? "").trim() || undefined;
    rows.push({ sku, purchasePrice, category });
  });

  return { rows, errors };
}

export type DetectedFormat =
  | "OZON_REALIZATION"
  | "OZON_PAYOUTS"
  | "OZON_ANALYTICS"
  | "WB_SALES"
  | "WB_FINANCE"
  | "GENERIC";

function detectFormat(
  headers: string[],
  fileName: string,
): { format: DetectedFormat; platform: Platform } {
  const lower = fileName.toLowerCase();
  const hset = new Set(headers.map(normKey));

  // Ozon analytics daily report: filename "analytics_report_daily_..."
  // Columns: "Артикул продавца", "Дата", "Заказано, шт.", "Заказано на сумму, руб.", ...
  const isOzonAnalytics =
    lower.includes("analytics_report") ||
    (hset.has("заказано,шт") && hset.has("артикулпродавца")) ||
    ([...hset].some((h) => h.includes("заказанонасумму")));

  if (isOzonAnalytics) return { format: "OZON_ANALYTICS", platform: "OZON" };

  // WB-specific column names — do NOT include "артикулпродавца" since Ozon also has it
  const isWb =
    lower.includes("wb") ||
    lower.includes("wildberries") ||
    hset.has("ppvzforpay") ||
    hset.has("supplieropername") ||
    hset.has("saname") ||
    hset.has("обоснованиедляоплаты") ||
    hset.has("кперечислениюпродавцу");

  if (isWb) {
    if (lower.includes("finance") || lower.includes("финанс"))
      return { format: "WB_FINANCE", platform: "WB" };
    return { format: "WB_SALES", platform: "WB" };
  }

  // Ozon-specific column names
  const isOzon =
    lower.includes("ozon") ||
    hset.has("ozon") ||
    hset.has("номеротправления") ||
    hset.has("типоперации") ||
    hset.has("датаоперации");

  if (isOzon) {
    if (lower.includes("payout") || lower.includes("выплат"))
      return { format: "OZON_PAYOUTS", platform: "OZON" };
    return { format: "OZON_REALIZATION", platform: "OZON" };
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

  // Check for commission/tariff table uploaded to the wrong section (2-row header)
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  if (rawRows.length >= 2) {
    const h0 = rawRows[0].map((c) => normKey(String(c ?? "")));
    const h1 = rawRows[1].map((c) => normKey(String(c ?? "")));
    const isOzonCommission = h0.some((h) => h === "fbo" || h.includes("fbo")) && h1.includes("типтовара");
    const isWbCommission = h0.includes("предмет") && h0.some((h) => h.includes("складwb") && !h.includes("продавца"));
    if (isOzonCommission || isWbCommission) {
      return {
        transactions: [],
        errors: ["Это файл с таблицей комиссий маркетплейса. Загрузите его в раздел «Тарифы» → «Импорт XLSX/CSV»."],
        format: "GENERIC",
        platform: "OZON",
      };
    }
  }

  const json = rowsFromSheet(sheet);
  const errors: string[] = [];
  const headers = json[0] ? Object.keys(json[0]) : [];
  const detection = detectFormat(headers, file.name);

  if (detection.format === "OZON_ANALYTICS") {
    return parseOzonAnalyticsReport(json, storeId, errors, detection);
  }
  if (detection.platform === "WB") {
    return parseWbReport(json, storeId, errors, detection);
  }
  return parseOzonReport(json, storeId, errors, detection);
}

function parseOzonReport(
  json: Record<string, unknown>[],
  storeId: string,
  errors: string[],
  detection: { format: DetectedFormat; platform: Platform },
): { transactions: Omit<Transaction, "id">[]; errors: string[]; format: DetectedFormat; platform: Platform } {
  const transactions: Omit<Transaction, "id">[] = [];

  json.forEach((row, i) => {
    const lineNo = i + 2;
    const orderId = String(
      pick(row, [
        "order_id", "номер заказа", "ordernumber",
        "номер отправления", "posting_number", "postingnumber",
        "номер поставки", "srid",
      ]) ?? "",
    ).trim();
    const sku = String(
      pick(row, [
        "sku", "артикул", "артикул продавца", "offer_id", "offerid",
        "barcode", "штрихкод", "nm_id", "nmid",
      ]) ?? "",
    ).trim();
    const dateRaw = pick(row, [
      "date", "дата", "дата операции", "date_from", "rr_dt",
      "sale_dt", "saledt", "order_dt", "orderdt",
    ]);
    const amount = parseNumber(
      pick(row, [
        "amount", "сумма", "сумма начисления", "итого",
        "ppvz_for_pay", "ppvzforpay", "выплата",
        "к перечислению", "к перечислению продавцу",
      ]),
    );
    const typeRaw = String(
      pick(row, [
        "type", "тип", "тип операции", "operation",
        "doc_type_name", "supplier_oper_name",
        "обоснование для оплаты", "тип документа",
      ]) ?? "",
    );
    const description = String(
      pick(row, [
        "description", "описание", "наименование", "наименование товара", "name",
      ]) ?? "",
    );

    if (!orderId && !sku) {
      errors.push(`Строка ${lineNo}: нет order_id и SKU — пропуск`);
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

  return { transactions, errors, format: detection.format, platform: detection.platform };
}

// ── Ozon analytics report (analytics_report_daily_*.xlsx) ────────────────────
// Each row = one SKU × one day with aggregate order/revenue figures.
// No individual order IDs — we synthesise one from SKU + date.
function parseOzonAnalyticsReport(
  json: Record<string, unknown>[],
  storeId: string,
  errors: string[],
  detection: { format: DetectedFormat; platform: Platform },
): { transactions: Omit<Transaction, "id">[]; errors: string[]; format: DetectedFormat; platform: Platform } {
  const transactions: Omit<Transaction, "id">[] = [];

  json.forEach((row, i) => {
    const lineNo = i + 2;
    const sku = String(
      pick(row, [
        "артикул продавца", "sku", "артикул", "offer_id", "offerid",
        "barcode", "артикул ozon",
      ]) ?? "",
    ).trim();
    if (!sku) {
      errors.push(`Строка ${lineNo}: нет артикула — пропуск`);
      return;
    }

    const dateRaw = pick(row, ["дата", "date", "дата продажи"]);
    const date = parseDate(dateRaw);

    // "Заказано на сумму, руб." is the primary revenue figure in analytics reports
    const amount = parseNumber(
      pick(row, [
        "заказано на сумму, руб.", "выкуплено на сумму, руб.",
        "выручка, руб.", "выручка",
        "заказано на сумму", "сумма заказов",
      ]),
    );
    if (amount === 0) {
      errors.push(`Строка ${lineNo}: нулевая сумма — пропуск`);
      return;
    }

    const description = String(
      pick(row, ["название товара", "наименование товара", "наименование", "name"]) ?? "",
    );

    // Synthetic orderId: SKU + date-only part so daily deduplication works
    const datePart = date.slice(0, 10);
    transactions.push({
      storeId,
      sku,
      orderId: `${sku}-${datePart}`,
      date,
      type: "SALE",
      amount,
      description: description || `Аналитика: ${sku}`,
      rawData: row,
      source: "upload",
    });
  });

  return { transactions, errors, format: detection.format, platform: detection.platform };
}

function parseWbReport(
  json: Record<string, unknown>[],
  storeId: string,
  errors: string[],
  detection: { format: DetectedFormat; platform: Platform },
): { transactions: Omit<Transaction, "id">[]; errors: string[]; format: DetectedFormat; platform: Platform } {
  const transactions: Omit<Transaction, "id">[] = [];

  json.forEach((row, i) => {
    const lineNo = i + 2;

    // WB SKU: "Артикул продавца" (sa_name) preferred over numeric nmID
    const sku = String(
      pick(row, [
        "sa_name", "saname", "артикул продавца", "vendor_code", "vendorcode",
        "артикул", "nm_id", "nmid", "артикул wb",
      ]) ?? "",
    ).trim();

    const srid = String(pick(row, ["srid"]) ?? "").trim();
    const rrdId = String(pick(row, ["rrd_id", "rrdid"]) ?? "").trim();
    const orderId = srid || rrdId;

    if (!orderId && !sku) {
      errors.push(`Строка ${lineNo}: нет srid/rrd_id и SKU — пропуск`);
      return;
    }

    const dateRaw = pick(row, [
      "sale_dt", "saledt", "дата продажи",
      "order_dt", "orderdt", "дата заказа",
      "date", "дата",
    ]);
    const date = parseDate(dateRaw);

    const typeRaw = String(
      pick(row, [
        "supplier_oper_name", "supplieropername", "обоснование для оплаты",
        "doc_type_name", "doctypename", "тип документа",
        "тип", "type",
      ]) ?? "",
    );
    const description = typeRaw || String(
      pick(row, ["наименование", "name"]) ?? "",
    );

    const base = { storeId, sku: sku || undefined, date, source: "upload" as const };

    // Main payout amount (ppvz_for_pay / К перечислению продавцу)
    const pay = parseNumber(pick(row, [
      "ppvz_for_pay", "ppvzforpay",
      "к перечислению продавцу", "к перечислению продавцу (руб.)",
      "к перечислению", "выплата", "amount", "сумма",
    ]));
    if (pay !== 0) {
      transactions.push({
        ...base,
        orderId: orderId || `ROW-${lineNo}`,
        externalId: srid ? `wb-${srid}` : undefined,
        type: classifyType(typeRaw, pay),
        amount: pay,
        description,
        rawData: row,
      });
    }

    // Delivery fee (отдельная транзакция)
    const delivery = parseNumber(pick(row, [
      "delivery_rub", "deliveryrub",
      "услуги по доставке", "доставка",
    ]));
    if (delivery > 0) {
      transactions.push({
        ...base,
        orderId: (orderId || `ROW-${lineNo}`) + "-log",
        externalId: srid ? `wb-${srid}-log` : undefined,
        type: "LOGISTICS",
        amount: -delivery,
        description: "Логистика WB",
      });
    }

    // Storage fee
    const storage = parseNumber(pick(row, [
      "storage_fee", "storagefee", "хранение",
    ]));
    if (storage > 0) {
      transactions.push({
        ...base,
        orderId: (orderId || `ROW-${lineNo}`) + "-stor",
        externalId: srid ? `wb-${srid}-stor` : undefined,
        type: "STORAGE",
        amount: -storage,
        description: "Хранение WB",
      });
    }

    // Penalty
    const penalty = parseNumber(pick(row, ["penalty", "штрафы", "штраф"]));
    if (penalty > 0) {
      transactions.push({
        ...base,
        orderId: (orderId || `ROW-${lineNo}`) + "-pen",
        externalId: srid ? `wb-${srid}-pen` : undefined,
        type: "PENALTY",
        amount: -penalty,
        description: "Штраф WB",
      });
    }

    // If nothing was added (all zero), still add the row if there's a pay amount
    if (pay === 0 && delivery === 0 && storage === 0 && penalty === 0) {
      errors.push(`Строка ${lineNo}: все суммы равны нулю — пропуск`);
    }
  });

  return { transactions, errors, format: detection.format, platform: detection.platform };
}
