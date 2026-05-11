"use client";

import { useState } from "react";
import { useAppStore, planLimits } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
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
  const updateProduct = useAppStore((s) => s.updateProduct);
  const addTransactions = useAppStore((s) => s.addTransactions);
  const products = useAppStore((s) => s.products);
  const { success, error: toastError, warn } = useToast();

  const [openAdd, setOpenAdd] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const editingStore = editingStoreId ? (stores.find((s) => s.id === editingStoreId) ?? null) : null;
  const [syncing, setSyncing] = useState<string | null>(null);

  // Local draft state for Performance credentials — saved only on "Готово"
  const [perfIdDraft, setPerfIdDraft] = useState("");
  const [perfSecretDraft, setPerfSecretDraft] = useState("");

  const limit = planLimits(settings.plan).stores;
  const reachedLimit = stores.length >= limit;

  const [form, setForm] = useState({
    platform: "OZON" as Platform,
    name: "",
    apiKey: "",
    clientId: "",
    perfClientId: "",
    perfClientSecret: "",
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
    setForm({ platform: "OZON", name: "", apiKey: "", clientId: "", perfClientId: "", perfClientSecret: "" });
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
      perfClientId: form.perfClientId.trim() || undefined,
      perfClientSecretEncoded: form.perfClientSecret.trim() ? encodeKey(form.perfClientSecret.trim()) : undefined,
      active: true,
    });
    reset();
    setOpenAdd(false);
  }

  function closeEdit() {
    if (editingStoreId) {
      const patch: Partial<Store> = { perfClientId: perfIdDraft.trim() || undefined };
      if (perfSecretDraft.trim()) {
        patch.perfClientSecretEncoded = typeof btoa !== "undefined" ? btoa(perfSecretDraft.trim()) : perfSecretDraft.trim();
      }
      updateStore(editingStoreId, patch);
    }
    setEditingStoreId(null);
  }

  async function handleSync(store: Store) {
    if (!store.apiKeyEncoded) {
      toastError("Нет API-ключа. Отредактируйте магазин и введите ключ заново.");
      return;
    }
    setSyncing(store.id);
    try {
      const result = await syncStore(store, products);
      let txResult = { inserted: 0, skipped: 0, updated: 0 };
      if (result.products.length > 0) bulkAddProducts(result.products);
      if (result.productUpdates.length > 0) {
        for (const { id, patch } of result.productUpdates) updateProduct(id, patch);
      }
      if (result.transactions.length > 0) txResult = addTransactions(result.transactions);
      updateStore(store.id, {
        lastSyncAt: new Date().toISOString(),
        ...(result.nextWbCursor ? { wbCardsCursor: result.nextWbCursor } : {}),
      });
      const parts: string[] = [];
      if (result.products.length > 0) parts.push(`+${result.products.length} товаров`);
      if (result.productUpdates.length > 0) parts.push(`обновлено ${result.productUpdates.length}`);
      if (txResult.inserted > 0) parts.push(`${txResult.inserted} новых транзакций`);
      if (txResult.updated > 0) parts.push(`${txResult.updated} обновлено`);
      if (txResult.skipped > 0) parts.push(`${txResult.skipped} дублей`);
      success(`${store.name}: ${parts.join(" · ") || "нет изменений"}`);
      if (result.warning) warn(result.warning);
    } catch (err) {
      toastError(`Ошибка синхронизации: ${(err as Error).message}`);
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
        <div className="card">
          <div className="empty-state">
            <svg className="w-12 h-12 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <p className="empty-state-title">Магазины не добавлены</p>
            <p className="empty-state-desc">Добавьте магазин Ozon или Wildberries, чтобы начать расчёт юнит-экономики.</p>
            <button className="btn-primary mt-2" onClick={() => setOpenAdd(true)}>
              + Добавить первый магазин
            </button>
          </div>
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
                  {!s.apiKeyEncoded && (
                    <span className="badge-warning text-xs">Нет ключа</span>
                  )}
                  <button
                    className="btn-primary text-xs px-3 py-1.5"
                    onClick={() => handleSync(s)}
                    disabled={syncing === s.id || !s.active || !s.apiKeyEncoded}
                    title={
                      !s.active ? "Магазин отключён" :
                      !s.apiKeyEncoded ? "Введите API-ключ через «Изменить»" :
                      "Загрузить товары и транзакции с маркетплейса"
                    }
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
                    onClick={() => {
                      setEditingStoreId(s.id);
                      setPerfIdDraft(s.perfClientId ?? "");
                      setPerfSecretDraft("");
                    }}
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
                  <span>Последняя синхр.: {formatDateTime(s.lastSyncAt)}</span>
                )}
              </div>
              {!s.apiKeyEncoded && (
                <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-3 py-1.5">
                  Это демо-магазин. Нажмите «Изменить» и введите реальный API-ключ маркетплейса, чтобы включить синхронизацию.
                </div>
              )}
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
            <>
              <div>
                <label className="label">Client-ID</label>
                <input
                  className="input"
                  value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  placeholder="230622"
                />
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs text-gray-500 mb-2 font-medium">
                  Performance API (реклама) — необязательно
                </p>
                <p className="text-xs text-gray-400 mb-2">
                  Отдельные ключи из Ozon Seller → Реклама → Продвижение → API
                </p>
              </div>
              <div>
                <label className="label">Performance Client-ID</label>
                <input
                  className="input"
                  value={form.perfClientId}
                  onChange={(e) => setForm({ ...form, perfClientId: e.target.value })}
                  placeholder="perf-client-id"
                />
              </div>
              <div>
                <label className="label">Performance Client-Secret</label>
                <input
                  className="input"
                  type="password"
                  value={form.perfClientSecret}
                  onChange={(e) => setForm({ ...form, perfClientSecret: e.target.value })}
                  placeholder="••••••••••"
                />
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={!!editingStore}
        onClose={closeEdit}
        title="Настройки магазина"
        size="sm"
        footer={
          <button className="btn-primary" onClick={closeEdit}>
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
            {editingStore.platform === "OZON" && (
              <>
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs text-gray-500 font-medium mb-1">
                    Performance API (реклама) — необязательно
                  </p>
                  <p className="text-xs text-gray-400 mb-2">
                    Ключи: Ozon Seller → Реклама → Продвижение → API
                  </p>
                </div>
                <div>
                  <label className="label">Performance Client-ID</label>
                  <input
                    className="input"
                    value={perfIdDraft}
                    onChange={(e) => setPerfIdDraft(e.target.value)}
                    placeholder="perf-client-id"
                  />
                </div>
                <div>
                  <label className="label">Performance Client-Secret</label>
                  <input
                    className="input"
                    type="password"
                    value={perfSecretDraft}
                    onChange={(e) => setPerfSecretDraft(e.target.value)}
                    placeholder={editingStore.perfClientSecretEncoded ? "••••••••• (введите для замены)" : "Введите секрет"}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
