"use client";

import { useAppStore } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";

export default function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const resetAll = useAppStore((s) => s.resetAll);

  return (
    <div>
      <PageHeader
        title="Настройки"
        subtitle="Параметры расчёта и тарифного плана"
      />

      <div className="card p-5 max-w-xl space-y-4">
        <div>
          <label className="label">Среднее число дней хранения</label>
          <input
            className="input"
            type="number"
            min={1}
            max={365}
            value={settings.storageDays}
            onChange={(e) =>
              updateSettings({
                storageDays: Math.max(1, parseInt(e.target.value) || 1),
              })
            }
          />
          <p className="text-xs text-gray-500 mt-1">
            Используется в формуле плановой стоимости хранения.
          </p>
        </div>
        <div>
          <label className="label">Тариф плана</label>
          <select
            className="input"
            value={settings.plan}
            onChange={(e) =>
              updateSettings({ plan: e.target.value as typeof settings.plan })
            }
          >
            <option value="FREE">Free — 1 магазин</option>
            <option value="PRO">Pro — 5 магазинов</option>
            <option value="ENTERPRISE">Enterprise — без лимита</option>
          </select>
        </div>
        <div>
          <label className="label">Ставка налога (УСН), %</label>
          <input
            className="input"
            type="number"
            min={0}
            max={20}
            step={0.1}
            value={settings.taxRatePct ?? 0}
            onChange={(e) =>
              updateSettings({
                taxRatePct: Math.max(0, parseFloat(e.target.value) || 0),
              })
            }
          />
          <p className="text-xs text-gray-500 mt-1">
            Рассчитывается от выручки. 0 — налог не учитывается. Например: УСН-6% → введите 6.
          </p>
        </div>
        <div>
          <label className="label">Валюта</label>
          <input className="input" value="RUB" disabled />
          <p className="text-xs text-gray-500 mt-1">
            В MVP поддерживаются только рубли.
          </p>
        </div>
      </div>

      <div className="card p-5 max-w-xl mt-6 border-rose-200 bg-rose-50">
        <h3 className="font-semibold text-rose-800 mb-2">Опасная зона</h3>
        <p className="text-sm text-rose-700 mb-3">
          Полное удаление всех магазинов, товаров, тарифов и транзакций.
        </p>
        <button
          className="btn-danger"
          onClick={() => {
            if (
              confirm(
                "Удалить ВСЕ данные? Действие необратимо.",
              )
            ) {
              resetAll();
              location.reload();
            }
          }}
        >
          Сбросить данные
        </button>
      </div>
    </div>
  );
}
