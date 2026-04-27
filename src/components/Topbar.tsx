"use client";

import { useAppStore } from "@/lib/store";

export function Topbar() {
  const stores = useAppStore((s) => s.stores);
  const products = useAppStore((s) => s.products);

  return (
    <header className="border-b border-gray-200 bg-white px-6 py-4 flex items-center justify-between">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">
          Юнит-экономика на маркетплейсах
        </h1>
        <p className="text-xs text-gray-500">
          Ozon · Wildberries — план / факт за 5 минут
        </p>
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-600">
        <span className="badge-info">Магазинов: {stores.length}</span>
        <span className="badge-muted">Товаров: {products.length}</span>
      </div>
    </header>
  );
}
