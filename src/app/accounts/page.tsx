"use client";

import { useState } from "react";
import { useAppStore, planLimits } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import { Modal } from "@/components/Modal";
import type { Platform, Store } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { syncStore } from "@/lib/marketplace";

export default function AccountsPage() {
  const stores = useAppStore((s) => s.stores);
  const settings = useAppStore((s) => s.settings);
  const addStore = useAppStore((s) => s.addStore);
  const updateStore = useAppStore((s) => s.updateStore);
  const removeStore = useAppStore((s) => s.removeStore);
  const bulkAddProducts = useAppStore((s) => s.bulkAddProducts);
  const addTransactions = useAppStore((s) => s.addTransactions);
  const products = useAppStore((s) => s.products);

  const [openAdd, setOpenAdd] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<Record<string, string>>({});

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
    if (key.length <= 8) return "*".repeat(key.length);
    return "*".repeat(Math.max(0, key.length - 4)) + key.slice(-4);
  }

  function encodeKey(key: string): string {
    return typeof btoa !== "undefined" ? btoa(key) : key;
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
      apiKeyEncoded: encodeKey(form.apiKey.trim()),
      clientId: form.platform === "OZON" ? form.clientId.trim() : undefined,
      active: true,
    });
    reset();
    setOpenAdd(false);
  }

  async function handleSync(store: Store) {
    if (!store.apiKeyEncoded) {
      setSyncResult((r) => ({
        ...r,
        [store.id]: "Нет API-ключа. Отредактируйте магазин и введите ключ заново.",
      }));
      return;
    }
    setSyncing(store.id);
    setSyncResult((r) => ({ ...r, [store.id]: "" }));
    try {
      const result = await syncStore(store, products);
      if (result.products.length > 0) {
        bulkAddProducts(result.products);
      }
      if (result.transactions.length > 0) {
        addTransactions(result.transactions);
      }
      updateStore(store.id, { lastSyncAt: new Date().toISOString() });
      setSyncResult((r) => ({
        ...r,
        [store.id]: `Синхронизировано: ${result.products.length} товаров, ${result.transactions.length} транзакций`,
      }));
    } catch (err) {
      setSyncResult((r) => ({
        ...r,
        [store.id]: `Ошибка: ${(err as Error).message}`,
      }));
    } finally {
      setSyncing(null);
    }
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
        <div className="space-y-3">
          {stores.map((s) => (
            <div key={s.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className={
                      s.platform === "OZON" ? "badge-info" : "badge-warning"
                    }
                  >
                    {s.platform}
                  </span>
                  <div>
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Client-ID: {s.clientId ?? "—"} · Ключ:{" "}
                      <span className="font-mono">{s.apiKeyMasked}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {s.active ? (
                    <span className="badge-success">Активен</span>
                  ) : (
                    <span className="badge-muted">Отключён</span>
                  )}
                  <button
                    className="btn-primary text-xs px-3 py-1.5"
                    onClick={() => handleSync(s)}
                    disabled={syncing === s.id || !s.active}
                    title={!s.active ? "Магазин отключён" : ""}
                  >
                    {syncing === s.id ? "Синхронизация…" : "Синхронизировать"}
                  </button>
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => updateStore(s.id, { active: !s.active })}
                  >
                    {s.active ? "Отключить" : "Включить"}
                  </button>
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => setEditingStore(s)}
                  >
                    Изменить
                  </button>
                  <button
                    className="btn-danger text-xs"
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
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                <span>Создан: {formatDate(s.createdAt)}</span>
                {s.lastSyncAt && (
                  <span>Синхр.: {formatDateTime(s.lastSyncAt)}</span>
                )}
                {syncResult[s.id] && (
                  <span
                    className={
                      syncResult[s.id].startsWith("Ошибка")
                        ? "text-rose-700"
                        : "text-emerald-700"
                    }
                  >
                    {syncResult[s.id]}
                  </span>
                )}
              </div>
            </div>
          ))}
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
              Ключ хранится в вашем браузере и используется для синхронизации с API маркетплейса.
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
                placeholder="230622"
              />
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!editingStore}
        onClose={() => setEditingStore(null)}
        title="Настройки магазина"
        size="sm"
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
              <label className="label">Обновить API-ключ</label>
              <input
                className="input"
                type="password"
                placeholder="Введите новый ключ"
                onChange={(e) => {
                  const val = e.target.value.trim();
                  if (!val) return;
                  const masked = val.length <= 8
                    ? "*".repeat(val.length)
                    : "*".repeat(val.length - 4) + val.slice(-4);
                  const encoded = typeof btoa !== "undefined" ? btoa(val) : val;
                  updateStore(editingStore.id, {
                    apiKeyMasked: masked,
                    apiKeyEncoded: encoded,
                  });
                }}
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
