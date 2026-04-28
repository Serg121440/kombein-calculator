import type { EconomicsModel } from "@/lib/types";

const MODELS: { id: EconomicsModel; short: string; long: string; hint: string }[] = [
  { id: "MODEL1", short: "М1", long: "Плановая",       hint: "Прогноз по тарифам до продаж" },
  { id: "MODEL2", short: "М2", long: "Фин. результат", hint: "Затраты ÷ выкупленные единицы" },
  { id: "MODEL3", short: "М3", long: "Факт + % выкупа", hint: "Затраты ÷ проданные × % выкупа" },
];

interface Props {
  value: EconomicsModel;
  onChange: (m: EconomicsModel) => void;
}

export function ModelPicker({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Модель расчёта"
      className="flex rounded-lg border border-gray-200 overflow-hidden text-sm"
    >
      {MODELS.map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={value === m.id}
          title={m.hint}
          onClick={() => onChange(m.id)}
          className={
            "px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 " +
            (value === m.id
              ? "bg-brand-600 text-white"
              : "text-gray-600 hover:bg-gray-50 bg-white")
          }
        >
          <span className="hidden sm:inline">
            {m.short} — {m.long}
          </span>
          <span className="sm:hidden">{m.short}</span>
        </button>
      ))}
    </div>
  );
}
