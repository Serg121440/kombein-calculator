/**
 * Transaction deduplication — two-layer strategy:
 *
 * Layer 1 — Natural Key (externalId):
 *   Marketplace-assigned IDs are globally unique.
 *   Ozon: operation_id  |  WB: srid (fallback: rrd_id)
 *   Fingerprint: "ext|{storeId}|{externalId}"
 *
 * Layer 2 — Content Key (no externalId):
 *   Normalized composite of storeId + orderId + date(YYYY-MM-DD) +
 *   amount(integer kopecks) + type + sku.
 *   Fingerprint: "cnt|{fields...}"
 *
 * Source Priority (lower = higher authority):
 *   api: 1  >  upload: 2  >  manual: 3
 *
 * On conflict:
 *   Higher-priority source overwrites lower-priority (API replaces upload).
 *   Same-or-lower priority → skip (first-write-wins within same source).
 */

export type DataSource = "api" | "upload" | "manual";

const PRIORITY: Record<DataSource, number> = {
  api: 1,
  upload: 2,
  manual: 3,
};

/** Returns numeric priority; undefined treated as lowest (backward compat). */
export function sourcePriority(source: DataSource | undefined): number {
  return source ? PRIORITY[source] : 3;
}

export function computeFingerprint(tx: {
  storeId: string;
  externalId?: string;
  orderId: string;
  date: string;
  amount: number;
  type: string;
  sku?: string;
}): string {
  if (tx.externalId) {
    return `ext|${tx.storeId}|${tx.externalId}`;
  }
  const dateKey = tx.date.slice(0, 10); // normalize to YYYY-MM-DD
  const kopeks = Math.round(Math.abs(tx.amount) * 100); // float → integer kopecks
  return `cnt|${tx.storeId}|${tx.orderId}|${dateKey}|${kopeks}|${tx.type}|${tx.sku ?? ""}`;
}

/** Legacy key format used before fingerprints (for backward compatibility). */
export function legacyKey(tx: {
  orderId: string;
  date: string;
  amount: number;
  type: string;
  sku?: string;
}): string {
  return `${tx.orderId}|${tx.date}|${tx.amount}|${tx.type}|${tx.sku ?? ""}`;
}
