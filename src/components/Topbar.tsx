"use client";

import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { useAuthStore } from "@/lib/auth";

export function Topbar() {
  const router = useRouter();
  const stores = useAppStore((s) => s.stores);
  const products = useAppStore((s) => s.products);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <header className="border-b border-gray-200 bg-white px-6 py-3 flex items-center justify-between">
      <div>
        <h1 className="text-base font-semibold text-gray-900 leading-tight">
          Юнит-экономика на маркетплейсах
        </h1>
        <p className="text-xs text-gray-500">
          Ozon · Wildberries — план / факт за 5 минут
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="badge-info text-xs">Магазинов: {stores.length}</span>
        <span className="badge-muted text-xs">Товаров: {products.length}</span>
        {user && (
          <div className="flex items-center gap-2 border-l pl-3 border-gray-200">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium text-gray-800 leading-tight">
                {user.name}
              </div>
              <div className="text-xs text-gray-500">{user.email}</div>
            </div>
            <button
              onClick={handleLogout}
              className="btn-secondary text-xs px-2 py-1"
              title="Выйти"
            >
              Выйти
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
