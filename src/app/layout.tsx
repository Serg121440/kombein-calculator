import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
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
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex flex-1 flex-col">
            <Topbar />
            <main className="flex-1 p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
