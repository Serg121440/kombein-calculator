"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/register", "/reset-password"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const isPublic = PUBLIC_PATHS.some(
      (p) => pathname === p || pathname?.startsWith(p + "/"),
    );
    const authed = isAuthenticated();

    if (!authed && !isPublic) {
      router.replace("/login");
      return;
    }
    if (authed && isPublic) {
      router.replace("/");
      return;
    }
    setChecked(true);
  }, [pathname, router, isAuthenticated, user]);

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        <svg
          className="animate-spin h-8 w-8"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </div>
    );
  }

  return <>{children}</>;
}
