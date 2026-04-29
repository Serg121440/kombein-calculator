"use client";

import { useMemo } from "react";

export type PeriodKey = "7d" | "30d" | "90d" | "thisMonth" | "lastMonth" | "custom";

export interface Period {
  key: PeriodKey;
  from: string;
  to: string;
  label: string;
}

export function buildPeriod(
  key: PeriodKey,
  custom?: { from: string; to: string },
): Period {
  const now = new Date();

  if (key === "custom") {
    const todayStr = now.toISOString().slice(0, 10);
    const fromStr =
      custom?.from ??
      new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const toStr = custom?.to ?? todayStr;
    return {
      key: "custom",
      from: new Date(fromStr + "T00:00:00").toISOString(),
      to: new Date(toStr + "T23:59:59.999").toISOString(),
      label: `${fromStr} — ${toStr}`,
    };
  }

  const to = now.toISOString();
  const from = new Date(now);

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

  const labels: Record<Exclude<PeriodKey, "custom">, string> = {
    "7d": "7 дней",
    "30d": "30 дней",
    "90d": "90 дней",
    thisMonth: "Текущий месяц",
    lastMonth: "Прошлый месяц",
  };
  return {
    key,
    from: from.toISOString(),
    to,
    label: labels[key as Exclude<PeriodKey, "custom">],
  };
}

interface Props {
  value: PeriodKey;
  onChange: (key: PeriodKey) => void;
  /** ISO date string (YYYY-MM-DD) — only used when value === "custom" */
  customFrom?: string;
  customTo?: string;
  onCustomChange?: (from: string, to: string) => void;
}

export function PeriodPicker({
  value,
  onChange,
  customFrom,
  customTo,
  onCustomChange,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  }, []);

  const presets: { k: PeriodKey; l: string }[] = useMemo(
    () => [
      { k: "7d", l: "7 дн" },
      { k: "30d", l: "30 дн" },
      { k: "90d", l: "90 дн" },
      { k: "thisMonth", l: "Тек. мес." },
      { k: "lastMonth", l: "Пр. мес." },
      { k: "custom", l: "Свой" },
    ],
    [],
  );

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 text-sm">
        {presets.map((it) => (
          <button
            key={it.k}
            onClick={() => onChange(it.k)}
            className={
              "px-2.5 py-1.5 rounded-md transition-colors " +
              (value === it.k
                ? "bg-brand-600 text-white"
                : "text-gray-700 hover:bg-gray-50")
            }
          >
            {it.l}
          </button>
        ))}
      </div>
      {value === "custom" && (
        <div className="flex items-center gap-1.5 text-sm">
          <input
            type="date"
            className="input py-1 text-sm"
            style={{ width: "140px" }}
            value={customFrom ?? defaultFrom}
            max={customTo ?? today}
            onChange={(e) =>
              onCustomChange?.(e.target.value, customTo ?? today)
            }
          />
          <span className="text-gray-400">—</span>
          <input
            type="date"
            className="input py-1 text-sm"
            style={{ width: "140px" }}
            value={customTo ?? today}
            min={customFrom}
            max={today}
            onChange={(e) =>
              onCustomChange?.(customFrom ?? defaultFrom, e.target.value)
            }
          />
        </div>
      )}
    </div>
  );
}
