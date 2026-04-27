"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const NAV = [
  { href: "/", label: "Дашборд", icon: "📊" },
  { href: "/accounts", label: "Магазины", icon: "🏬" },
  { href: "/products", label: "Товары", icon: "📦" },
  { href: "/tariffs", label: "Тарифы", icon: "📑" },
  { href: "/reports", label: "Отчёты", icon: "📥" },
  { href: "/analytics", label: "Аналитика", icon: "📈" },
  { href: "/settings", label: "Настройки", icon: "⚙️" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:flex-col w-64 border-r border-gray-200 bg-white px-4 py-6">
      <div className="mb-8 flex items-center gap-2 px-2">
        <div className="h-9 w-9 rounded-xl bg-brand-600 text-white grid place-items-center font-bold">
          K
        </div>
        <div>
          <div className="font-semibold text-gray-900 leading-tight">
            Комбайн
          </div>
          <div className="text-xs text-gray-500">Юнит-экономика MP</div>
        </div>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-gray-700 hover:bg-gray-50",
              )}
            >
              <span aria-hidden>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto pt-6 text-xs text-gray-400 px-2">
        v0.1 · MVP · только RUB
      </div>
    </aside>
  );
}
