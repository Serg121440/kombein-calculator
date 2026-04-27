"use client";

import { useMemo } from "react";

export type PeriodKey = "7d" | "30d" | "90d" | "thisMonth" | "lastMonth";

export interface Period {
  key: PeriodKey;
  from: string;
  to: string;
  label: string;
}

export function buildPeriod(key: PeriodKey): Period {
  const now = new Date();
  const to = now.toISOString();
  const from = new Date();
  if (key === "7d") from.setDate(from.getDate() - 7);
  else if (key === "30d") from.setDate(from.getDate() - 30);
  else if (key === "90d") from.setDate(from.getDate() - 90);
  else if (key === "thisMonth") {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  } else if (key === "lastMonth") {
    from.setMonth(from.getMonth() - 1, 1);
    from.setHours(0, 0, 0, 0);
    const end = new Date(from);
    end.setMonth(end.getMonth() + 1);
    end.setMilliseconds(-1);
    return {
      key,
      from: from.toISOString(),
      to: end.toISOString(),
      label: "Прошлый месяц",
    };
  }
  const labels: Record<PeriodKey, string> = {
    "7d": "7 дней",
    "30d": "30 дней",
    "90d": "90 дней",
    thisMonth: "Текущий месяц",
    lastMonth: "Прошлый месяц",
  };
  return { key, from: from.toISOString(), to, label: labels[key] };
}

interface Props {
  value: PeriodKey;
  onChange: (key: PeriodKey) => void;
}

export function PeriodPicker({ value, onChange }: Props) {
  const items: { k: PeriodKey; l: string }[] = useMemo(
    () => [
      { k: "7d", l: "7 дн" },
      { k: "30d", l: "30 дн" },
      { k: "90d", l: "90 дн" },
      { k: "thisMonth", l: "Текущий мес." },
      { k: "lastMonth", l: "Прошлый мес." },
    ],
    [],
  );

  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 text-sm">
      {items.map((it) => (
        <button
          key={it.k}
          onClick={() => onChange(it.k)}
          className={
            "px-3 py-1.5 rounded-md transition-colors " +
            (value === it.k
              ? "bg-brand-600 text-white"
              : "text-gray-700 hover:bg-gray-50")
          }
        >
          {it.l}
        </button>
      ))}
    </div>
  );
}
