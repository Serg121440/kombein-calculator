"use client";

import { useState } from "react";
import { useAppStore, planLimits } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import { Modal } from "@/components/Modal";
import type { Platform, Store } from "@/lib/types";
import { formatDate } from "@/lib/format";

export default function AccountsPage() {
  const stores = useAppStore((s) => s.stores);
  const settings = useAppStore((s) => s.settings);
  const addStore = useAppStore((s) => s.addStore);
  const updateStore = useAppStore((s) => s.updateStore);
  const removeStore = useAppStore((s) => s.removeStore);

  const [openAdd, setOpenAdd] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);

  const limit = planLimits(settings.plan).stores;
  const reachedLimit = stores.length >= limit;

  const [form, setForm] = useState({
    platform: "OZON" as Platform,
    name: "",
    apiKey: "",
    clientId: "",
  });

  function maskKey(key: string) {
    if (!key) return "";
    if (key.length <= 4) return "*".repeat(key.length);
    return "*".repeat(Math.max(0, key.length - 4)) + key.slice(-4);
  }

  function reset() {
    setForm({ platform: "OZON", name: "", apiKey: "", clientId: "" });
  }

  function submit() {
    if (!form.name.trim() || !form.apiKey.trim()) return;
    if (form.platform === "OZON" && !form.clientId.trim()) return;
    addStore({
      platform: form.platform,
      name: form.name.trim(),
      apiKeyMasked: maskKey(form.apiKey.trim()),
      clientId: form.platform === "OZON" ? form.clientId.trim() : undefined,
      active: true,
    });
    reset();
    setOpenAdd(false);
  }

  return (
    <div>
      <PageHeader
        title="Магазины"
        subtitle={`Тариф: ${settings.plan} · лимит: ${
          limit === Infinity ? "безлимит" : limit
        }`}
        actions={
          <button
            className="btn-primary"
            onClick={() => setOpenAdd(true)}
            disabled={reachedLimit}
            title={reachedLimit ? "Достигнут лимит магазинов на тарифе" : ""}
          >
            + Добавить магазин
          </button>
        }
      />

      {stores.length === 0 ? (
        <div className="card p-8 text-center text-gray-600">
          Магазины ещё не добавлены.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Платформа</th>
                <th>Название</th>
                <th>API-ключ</th>
                <th>Client-ID</th>
                <th>Статус</th>
                <th>Создан</th>
                <th className="text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stores.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span
                      className={
                        s.platform === "OZON" ? "badge-info" : "badge-warning"
                      }
                    >
                      {s.platform}
                    </span>
                  </td>
                  <td className="font-medium">{s.name}</td>
                  <td className="font-mono text-xs">{s.apiKeyMasked}</td>
                  <td className="font-mono text-xs">{s.clientId ?? "—"}</td>
                  <td>
                    {s.active ? (
                      <span className="badge-success">Активен</span>
                    ) : (
                      <span className="badge-muted">Отключён</span>
                    )}
                  </td>
                  <td>{formatDate(s.createdAt)}</td>
                  <td className="text-right">
                    <button
                      className="btn-secondary mr-2"
                      onClick={() =>
                        updateStore(s.id, { active: !s.active })
                      }
                    >
                      {s.active ? "Отключить" : "Включить"}
                    </button>
                    <button
                      className="btn-secondary mr-2"
                      onClick={() => setEditingStore(s)}
                    >
                      Изменить
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => {
                        if (
                          confirm(
                            `Удалить магазин "${s.name}"? Все связанные данные тоже будут удалены.`,
                          )
                        ) {
                          removeStore(s.id);
                        }
                      }}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={openAdd}
        onClose={() => {
          reset();
          setOpenAdd(false);
        }}
        title="Добавить магазин"
        footer={
          <>
            <button
              className="btn-secondary"
              onClick={() => {
                reset();
                setOpenAdd(false);
              }}
            >
              Отмена
            </button>
            <button className="btn-primary" onClick={submit}>
              Сохранить
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <div>
            <label className="label">Платформа</label>
            <select
              className="input"
              value={form.platform}
              onChange={(e) =>
                setForm({ ...form, platform: e.target.value as Platform })
              }
            >
              <option value="OZON">Ozon</option>
              <option value="WB">Wildberries</option>
            </select>
          </div>
          <div>
            <label className="label">Название</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Мой магазин"
            />
          </div>
          <div>
            <label className="label">API-ключ</label>
            <input
              className="input"
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="••••••••••"
            />
            <p className="text-xs text-gray-500 mt-1">
              Ключ хранится только в вашем браузере и отображается замаскированным.
            </p>
          </div>
          {form.platform === "OZON" && (
            <div>
              <label className="label">Client-ID</label>
              <input
                className="input"
                value={form.clientId}
                onChange={(e) =>
                  setForm({ ...form, clientId: e.target.value })
                }
                placeholder="123456"
              />
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!editingStore}
        onClose={() => setEditingStore(null)}
        title="Настройки магазина"
        footer={
          <button
            className="btn-primary"
            onClick={() => setEditingStore(null)}
          >
            Готово
          </button>
        }
      >
        {editingStore && (
          <div className="grid gap-3">
            <div>
              <label className="label">Название</label>
              <input
                className="input"
                value={editingStore.name}
                onChange={(e) =>
                  updateStore(editingStore.id, { name: e.target.value })
                }
              />
            </div>
            <div>
              <label className="label">Активен</label>
              <select
                className="input"
                value={editingStore.active ? "1" : "0"}
                onChange={(e) =>
                  updateStore(editingStore.id, {
                    active: e.target.value === "1",
                  })
                }
              >
                <option value="1">Да</option>
                <option value="0">Нет</option>
              </select>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
