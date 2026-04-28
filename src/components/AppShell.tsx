"use client";

import { usePathname } from "next/navigation";
import { AuthGuard } from "./AuthGuard";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

const PUBLIC_PATHS = ["/login", "/register", "/reset-password"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname?.startsWith(p + "/"),
  );

  if (isPublic) {
    return <AuthGuard>{children}</AuthGuard>;
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <Topbar />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
