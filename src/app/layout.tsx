import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { SeedInitializer } from "@/components/SeedInitializer";

export const metadata: Metadata = {
  title: "Комбайн — юнит-экономика маркетплейсов",
  description:
    "Расчёт плановой и фактической юнит-экономики товаров на Ozon и Wildberries",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className="min-h-screen">
        <SeedInitializer />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
