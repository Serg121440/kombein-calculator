interface Props {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "bad" | "warn";
}

const toneClass = {
  default: "text-gray-900",
  good: "text-emerald-700",
  bad: "text-rose-700",
  warn: "text-amber-700",
} as const;

export function KpiCard({ label, value, hint, tone = "default" }: Props) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass[tone]}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}
