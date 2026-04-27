"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { seedDemoData } from "@/lib/seed";

export function SeedInitializer() {
  const hasHydrated = useAppStore((s) => s.hasHydrated);

  useEffect(() => {
    if (!hasHydrated) return;
    const state = useAppStore.getState();
    if (state.stores.length === 0 && state.products.length === 0) {
      seedDemoData();
    }
  }, [hasHydrated]);

  return null;
}
