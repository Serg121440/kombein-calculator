"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import type {
  AppSettings,
  ImportReport,
  Product,
  Store,
  Tariff,
  Transaction,
} from "./types";

interface State {
  hasHydrated: boolean;
  settings: AppSettings;
  stores: Store[];
  products: Product[];
  tariffs: Tariff[];
  transactions: Transaction[];
  reports: ImportReport[];

  // Stores
  addStore: (s: Omit<Store, "id" | "createdAt">) => Store;
  updateStore: (id: string, patch: Partial<Store>) => void;
  removeStore: (id: string) => void;

  // Products
  addProduct: (p: Omit<Product, "id" | "createdAt">) => Product;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  removeProduct: (id: string) => void;
  bulkAddProducts: (products: Omit<Product, "id" | "createdAt">[]) => void;

  // Tariffs
  addTariff: (t: Omit<Tariff, "id" | "createdAt">) => Tariff;
  updateTariff: (id: string, patch: Partial<Tariff>) => void;
  removeTariff: (id: string) => void;
  bulkAddTariffs: (tariffs: Omit<Tariff, "id" | "createdAt">[]) => void;

  // Transactions
  addTransactions: (txs: Omit<Transaction, "id">[]) => {
    inserted: number;
    skipped: number;
  };
  removeTransactionsByReport: (reportId: string) => void;

  // Reports
  addReport: (r: Omit<ImportReport, "id">) => ImportReport;
  removeReport: (id: string) => void;

  // Settings
  updateSettings: (patch: Partial<AppSettings>) => void;

  // Reset
  resetAll: () => void;
  setHydrated: () => void;
}

const defaultSettings: AppSettings = {
  storageDays: 30,
  defaultCurrency: "RUB",
  plan: "PRO",
};

export const useAppStore = create<State>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      settings: defaultSettings,
      stores: [],
      products: [],
      tariffs: [],
      transactions: [],
      reports: [],

      addStore: (s) => {
        const store: Store = {
          ...s,
          id: uuid(),
          createdAt: new Date().toISOString(),
        };
        set({ stores: [...get().stores, store] });
        return store;
      },
      updateStore: (id, patch) =>
        set({
          stores: get().stores.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        }),
      removeStore: (id) =>
        set({
          stores: get().stores.filter((s) => s.id !== id),
          products: get().products.filter((p) => p.storeId !== id),
          tariffs: get().tariffs.filter((t) => t.storeId !== id),
          transactions: get().transactions.filter((t) => t.storeId !== id),
          reports: get().reports.filter((r) => r.storeId !== id),
        }),

      addProduct: (p) => {
        const product: Product = {
          ...p,
          id: uuid(),
          createdAt: new Date().toISOString(),
        };
        set({ products: [...get().products, product] });
        return product;
      },
      updateProduct: (id, patch) =>
        set({
          products: get().products.map((p) =>
            p.id === id ? { ...p, ...patch } : p,
          ),
        }),
      removeProduct: (id) =>
        set({ products: get().products.filter((p) => p.id !== id) }),
      bulkAddProducts: (products) => {
        const now = new Date().toISOString();
        const items = products.map((p) => ({
          ...p,
          id: uuid(),
          createdAt: now,
        }));
        set({ products: [...get().products, ...items] });
      },

      addTariff: (t) => {
        const tariff: Tariff = {
          ...t,
          id: uuid(),
          createdAt: new Date().toISOString(),
        };
        set({ tariffs: [...get().tariffs, tariff] });
        return tariff;
      },
      updateTariff: (id, patch) =>
        set({
          tariffs: get().tariffs.map((t) =>
            t.id === id ? { ...t, ...patch } : t,
          ),
        }),
      removeTariff: (id) =>
        set({ tariffs: get().tariffs.filter((t) => t.id !== id) }),
      bulkAddTariffs: (tariffs) => {
        const now = new Date().toISOString();
        const items = tariffs.map((t) => ({
          ...t,
          id: uuid(),
          createdAt: now,
        }));
        set({ tariffs: [...get().tariffs, ...items] });
      },

      addTransactions: (txs) => {
        const existing = get().transactions;
        const seen = new Set(
          existing.map(
            (t) => `${t.orderId}|${t.date}|${t.amount}|${t.type}|${t.sku ?? ""}`,
          ),
        );
        const fresh: Transaction[] = [];
        let skipped = 0;
        for (const tx of txs) {
          const key = `${tx.orderId}|${tx.date}|${tx.amount}|${tx.type}|${tx.sku ?? ""}`;
          if (seen.has(key)) {
            skipped++;
            continue;
          }
          seen.add(key);
          fresh.push({ ...tx, id: uuid() });
        }
        set({ transactions: [...existing, ...fresh] });
        return { inserted: fresh.length, skipped };
      },
      removeTransactionsByReport: (reportId) =>
        set({
          transactions: get().transactions.filter(
            (t) => t.reportId !== reportId,
          ),
        }),

      addReport: (r) => {
        const report: ImportReport = { ...r, id: uuid() };
        set({ reports: [...get().reports, report] });
        return report;
      },
      removeReport: (id) => {
        set({
          reports: get().reports.filter((r) => r.id !== id),
          transactions: get().transactions.filter((t) => t.reportId !== id),
        });
      },

      updateSettings: (patch) =>
        set({ settings: { ...get().settings, ...patch } }),

      resetAll: () =>
        set({
          settings: defaultSettings,
          stores: [],
          products: [],
          tariffs: [],
          transactions: [],
          reports: [],
        }),

      setHydrated: () => set({ hasHydrated: true }),
    }),
    {
      name: "kombein-state-v1",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return window.localStorage;
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    },
  ),
);

export function planLimits(plan: AppSettings["plan"]) {
  if (plan === "FREE") return { stores: 1, products: 100 };
  if (plan === "PRO") return { stores: 5, products: 10000 };
  return { stores: Infinity, products: Infinity };
}
