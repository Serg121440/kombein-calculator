"use client";

import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { useAuthStore } from "@/lib/auth";
import { MobileNav } from "./Sidebar";

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
    <header className="border-b border-gray-200 bg-white px-4 md:px-6 py-3 flex items-center gap-3">
      <MobileNav />

      <div className="flex-1 min-w-0">
        <h1 className="text-sm font-semibold text-gray-900 leading-tight truncate">
          Юнит-экономика на маркетплейсах
        </h1>
        <p className="text-xs text-gray-500 hidden sm:block">
          Ozon · Wildberries — план / факт за 5 минут
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="badge-info text-xs hidden sm:inline-flex">
          {stores.length} маг.
        </span>
        <span className="badge-muted text-xs hidden sm:inline-flex">
          {products.length} тов.
        </span>

        {user && (
          <div className="flex items-center gap-2 border-l pl-3 border-gray-200">
            <div className="text-right hidden lg:block">
              <div className="text-sm font-medium text-gray-800 leading-tight">
                {user.name}
              </div>
              <div className="text-xs text-gray-500">{user.email}</div>
            </div>
            <button
              onClick={handleLogout}
              className="btn-secondary text-xs px-2 py-1 focus-visible:ring-2 focus-visible:ring-brand-500"
              aria-label="Выйти из аккаунта"
            >
              Выйти
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
