"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { PageHeader } from "@/components/PageHeader";
import { Modal } from "@/components/Modal";
import type { Product } from "@/lib/types";
import { formatRub } from "@/lib/format";
import { calculatePlan } from "@/lib/economics";
import { exportProductsCsv } from "@/lib/export";

const PAGE_SIZE = 20;

export default function ProductsPage() {
  const stores = useAppStore((s) => s.stores);
  const products = useAppStore((s) => s.products);
  const tariffs = useAppStore((s) => s.tariffs);
  const settings = useAppStore((s) => s.settings);
  const addProduct = useAppStore((s) => s.addProduct);
  const updateProduct = useAppStore((s) => s.updateProduct);
  const removeProduct = useAppStore((s) => s.removeProduct);

  const [openForm, setOpenForm] = useState<null | Product | "new">(null);
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    return products
      .filter((p) => storeFilter === "ALL" || p.storeId === storeFilter)
      .filter((p) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return (
          p.sku.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
        );
      });
  }, [products, storeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const initialForm = useMemo<Omit<Product, "id" | "createdAt">>(
    () => ({
      storeId: stores[0]?.id ?? "",
      sku: "",
      name: "",
      category: "",
      purchasePrice: 0,
      sellingPrice: 0,
      weightKg: 0,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      active: true,
    }),
    [stores],
  );

  const [form, setForm] = useState(initialForm);

  function openCreate() {
    setForm(initialForm);
    setOpenForm("new");
  }
  function openEdit(p: Product) {
    setForm({
      storeId: p.storeId,
      sku: p.sku,
      name: p.name,
      category: p.category,
      purchasePrice: p.purchasePrice,
      sellingPrice: p.sellingPrice,
      weightKg: p.weightKg,
      lengthCm: p.lengthCm,
      widthCm: p.widthCm,
      heightCm: p.heightCm,
      active: p.active,
    });
    setOpenForm(p);
  }

  function submit() {
    if (!form.storeId || !form.sku.trim() || !form.name.trim()) return;
    if (openForm === "new") {
      addProduct(form);
    } else if (openForm) {
      updateProduct(openForm.id, form);
    }
    setOpenForm(null);
  }

  return (
    <div>
      <PageHeader
        title="Товары"
        subtitle="Каталог товаров с плановой юнит-экономикой"
        actions={
          <>
            <button
              className="btn-secondary"
              onClick={() => exportProductsCsv(filtered, tariffs, settings)}
            >
              Экспорт CSV
            </button>
            <button
              className="btn-primary"
              onClick={openCreate}
              disabled={stores.length === 0}
              title={stores.length === 0 ? "Сначала добавьте магазин" : ""}
            >
              + Добавить товар
            </button>
          </>
        }
      />

      <div className="card p-3 mb-4 flex flex-wrap gap-3 items-center">
        <select
          className="input w-auto"
          value={storeFilter}
          onChange={(e) => {
            setStoreFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="ALL">Все магазины</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.platform}
            </option>
          ))}
        </select>
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Поиск по SKU, названию, категории"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <div className="text-sm text-gray-500">
          Найдено: {filtered.length}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <svg className="w-12 h-12 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
            <p className="empty-state-title">
              {search || storeFilter !== "ALL" ? "Товары не найдены" : "Товаров пока нет"}
            </p>
            <p className="empty-state-desc">
              {search || storeFilter !== "ALL"
                ? "Попробуйте изменить фильтры или поисковый запрос."
                : "Добавьте первый товар или синхронизируйте магазин."}
            </p>
            {(search || storeFilter !== "ALL") ? (
              <button className="btn-secondary mt-2" onClick={() => { setSearch(""); setStoreFilter("ALL"); }}>
                Сбросить фильтры
              </button>
            ) : (
              <button className="btn-primary mt-2" onClick={openCreate} disabled={stores.length === 0}>
                + Добавить товар
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Название</th>
                <th>Категория</th>
                <th>Магазин</th>
                <th className="text-right">Себест.</th>
                <th className="text-right">Цена</th>
                <th className="text-right">Прибыль/шт</th>
                <th className="text-right">Маржа</th>
                <th className="text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageData.map((p) => {
                const store = stores.find((s) => s.id === p.storeId);
                const plan = calculatePlan(p, tariffs, {
                  storageDays: settings.storageDays,
                });
                return (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.sku}</td>
                    <td>
                      <Link
                        href={`/products/${p.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td>{p.category || "—"}</td>
                    <td>{store ? `${store.name} · ${store.platform}` : "—"}</td>
                    <td className="text-right">{formatRub(p.purchasePrice)}</td>
                    <td className="text-right">{formatRub(p.sellingPrice)}</td>
                    <td
                      className={
                        "text-right " +
                        (plan.grossProfit >= 0
                          ? "text-emerald-700"
                          : "text-rose-700")
                      }
                    >
                      {formatRub(plan.grossProfit)}
                    </td>
                    <td
                      className={
                        "text-right " +
                        (plan.marginPct >= 15
                          ? "text-emerald-700"
                          : plan.marginPct >= 0
                            ? "text-amber-700"
                            : "text-rose-700")
                      }
                    >
                      {plan.marginPct.toFixed(1)}%
                    </td>
                    <td className="text-right">
                      <button
                        className="btn-secondary mr-2"
                        onClick={() => openEdit(p)}
                      >
                        Изменить
                      </button>
                      <button
                        className="btn-secondary mr-2"
                        onClick={() =>
                          updateProduct(p.id, { active: !p.active })
                        }
                      >
                        {p.active ? "Деактивировать" : "Активировать"}
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => {
                          if (confirm(`Удалить товар "${p.name}"?`)) {
                            removeProduct(p.id);
                          }
                        }}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex items-center justify-between p-3 text-sm text-gray-600">
            <div>
              Страница {page} из {totalPages} · {filtered.length} товаров
            </div>
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Предыдущая страница"
              >
                ← Назад
              </button>
              <button
                className="btn-secondary"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label="Следующая страница"
              >
                Вперёд →
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={openForm !== null}
        onClose={() => setOpenForm(null)}
        title={openForm === "new" ? "Добавить товар" : "Изменить товар"}
        size="lg"
        footer={
          <>
            <button
              className="btn-secondary"
              onClick={() => setOpenForm(null)}
            >
              Отмена
            </button>
            <button className="btn-primary" onClick={submit}>
              Сохранить
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Магазин</label>
            <select
              className="input"
              value={form.storeId}
              onChange={(e) => setForm({ ...form, storeId: e.target.value })}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.platform}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">SKU</label>
            <input
              className="input"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label">Название</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Категория</label>
            <input
              className="input"
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">Активен</label>
            <select
              className="input"
              value={form.active ? "1" : "0"}
              onChange={(e) =>
                setForm({ ...form, active: e.target.value === "1" })
              }
            >
              <option value="1">Да</option>
              <option value="0">Нет</option>
            </select>
          </div>
          <div>
            <label className="label">Себестоимость, ₽</label>
            <input
              className="input"
              type="number"
              min={0}
              step={0.01}
              value={form.purchasePrice}
              onChange={(e) =>
                setForm({
                  ...form,
                  purchasePrice: parseFloat(e.target.value) || 0,
                })
              }
            />
          </div>
          <div>
            <label className="label">Цена продажи, ₽</label>
            <input
              className="input"
              type="number"
              min={0}
              step={0.01}
              value={form.sellingPrice}
              onChange={(e) =>
                setForm({
                  ...form,
                  sellingPrice: parseFloat(e.target.value) || 0,
                })
              }
            />
          </div>
          <div>
            <label className="label">Вес, кг</label>
            <input
              className="input"
              type="number"
              min={0}
              step={0.01}
              value={form.weightKg}
              onChange={(e) =>
                setForm({
                  ...form,
                  weightKg: parseFloat(e.target.value) || 0,
                })
              }
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label">Длина, см</label>
              <input
                className="input"
                type="number"
                min={0}
                step={0.1}
                value={form.lengthCm}
                onChange={(e) =>
                  setForm({
                    ...form,
                    lengthCm: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
            <div>
              <label className="label">Ширина, см</label>
              <input
                className="input"
                type="number"
                min={0}
                step={0.1}
                value={form.widthCm}
                onChange={(e) =>
                  setForm({
                    ...form,
                    widthCm: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
            <div>
              <label className="label">Высота, см</label>
              <input
                className="input"
                type="number"
                min={0}
                step={0.1}
                value={form.heightCm}
                onChange={(e) =>
                  setForm({
                    ...form,
                    heightCm: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
