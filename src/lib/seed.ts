"use client";

import { useAppStore } from "./store";

export function seedDemoData() {
  const state = useAppStore.getState();
  if (state.stores.length > 0) return;

  const ozon = state.addStore({
    platform: "OZON",
    name: "Мой магазин Ozon",
    apiKeyMasked: "******demo",
    clientId: "1234567",
    active: true,
  });
  const wb = state.addStore({
    platform: "WB",
    name: "Мой магазин WB",
    apiKeyMasked: "******demo",
    active: true,
  });

  const baseDate = new Date();
  baseDate.setMonth(baseDate.getMonth() - 1);
  const fromIso = new Date(2024, 0, 1).toISOString();

  // Tariffs
  state.bulkAddTariffs([
    {
      storeId: ozon.id,
      platform: "OZON",
      type: "COMMISSION",
      category: "*",
      value: 12,
      effectiveFrom: fromIso,
      source: "MANUAL",
    },
    {
      storeId: ozon.id,
      platform: "OZON",
      type: "ACQUIRING",
      category: "*",
      value: 1.5,
      effectiveFrom: fromIso,
      source: "MANUAL",
    },
    {
      storeId: ozon.id,
      platform: "OZON",
      type: "LOGISTICS",
      category: "*",
      value: 90,
      formula: "weight",
      effectiveFrom: fromIso,
      source: "MANUAL",
    },
    {
      storeId: ozon.id,
      platform: "OZON",
      type: "STORAGE",
      category: "*",
      value: 0.2,
      effectiveFrom: fromIso,
      source: "MANUAL",
    },
    {
      storeId: ozon.id,
      platform: "OZON",
      type: "LAST_MILE",
      category: "*",
      value: 25,
      effectiveFrom: fromIso,
      source: "MANUAL",
    },

    {
      storeId: wb.id,
      platform: "WB",
      type: "COMMISSION",
      category: "*",
      value: 17,
      effectiveFrom: fromIso,
      source: "MANUAL",
    },
    {
      storeId: wb.id,
      platform: "WB",
      type: "ACQUIRING",
      category: "*",
      value: 0,
      effectiveFrom: fromIso,
      source: "MANUAL",
    },
    {
      storeId: wb.id,
      platform: "WB",
      type: "LOGISTICS",
      category: "*",
      value: 60,
      effectiveFrom: fromIso,
      source: "MANUAL",
    },
    {
      storeId: wb.id,
      platform: "WB",
      type: "STORAGE",
      category: "*",
      value: 0.15,
      effectiveFrom: fromIso,
      source: "MANUAL",
    },
  ]);

  // Products
  state.bulkAddProducts([
    {
      storeId: ozon.id,
      sku: "OZ-TSH-001",
      name: "Футболка хлопок белая",
      category: "Одежда",
      purchasePrice: 350,
      sellingPrice: 1290,
      weightKg: 0.25,
      lengthCm: 25,
      widthCm: 18,
      heightCm: 3,
      active: true,
    },
    {
      storeId: ozon.id,
      sku: "OZ-MUG-002",
      name: "Кружка керамическая 350мл",
      category: "Дом",
      purchasePrice: 180,
      sellingPrice: 690,
      weightKg: 0.45,
      lengthCm: 12,
      widthCm: 10,
      heightCm: 10,
      active: true,
    },
    {
      storeId: wb.id,
      sku: "WB-SHO-001",
      name: "Кроссовки беговые",
      category: "Обувь",
      purchasePrice: 1800,
      sellingPrice: 4490,
      weightKg: 0.9,
      lengthCm: 32,
      widthCm: 22,
      heightCm: 14,
      active: true,
    },
    {
      storeId: wb.id,
      sku: "WB-BAG-002",
      name: "Рюкзак городской",
      category: "Сумки",
      purchasePrice: 850,
      sellingPrice: 1890,
      weightKg: 0.6,
      lengthCm: 45,
      widthCm: 30,
      heightCm: 15,
      active: true,
    },
  ]);

  // Demo transactions for last 30 days
  const products = useAppStore.getState().products;
  const txs: Parameters<typeof state.addTransactions>[0] = [];
  const now = new Date();
  for (const product of products) {
    const sales = Math.floor(Math.random() * 30) + 10;
    for (let i = 0; i < sales; i++) {
      const day = Math.floor(Math.random() * 30);
      const dt = new Date(now);
      dt.setDate(dt.getDate() - day);
      const orderId = `ORD-${product.sku}-${i}-${day}`;
      txs.push({
        storeId: product.storeId,
        productId: product.id,
        sku: product.sku,
        orderId,
        date: dt.toISOString(),
        type: "SALE",
        amount: product.sellingPrice,
        description: `Продажа ${product.name}`,
      });
      txs.push({
        storeId: product.storeId,
        productId: product.id,
        sku: product.sku,
        orderId,
        date: dt.toISOString(),
        type: "COMMISSION",
        amount: -product.sellingPrice * 0.13,
        description: "Комиссия",
      });
      txs.push({
        storeId: product.storeId,
        productId: product.id,
        sku: product.sku,
        orderId,
        date: dt.toISOString(),
        type: "LOGISTICS",
        amount: -70,
        description: "Логистика",
      });
    }
    // a couple of penalties / refunds
    if (Math.random() > 0.5) {
      const dt = new Date(now);
      dt.setDate(dt.getDate() - Math.floor(Math.random() * 30));
      txs.push({
        storeId: product.storeId,
        productId: product.id,
        sku: product.sku,
        orderId: `PEN-${product.sku}`,
        date: dt.toISOString(),
        type: "PENALTY",
        amount: -200,
        description: "Штраф",
      });
    }
  }
  state.addTransactions(txs);
}
