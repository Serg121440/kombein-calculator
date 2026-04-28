/**
 * API Endpoint Registry — единый источник правды о том,
 * что, куда и зачем вызывается.
 *
 * Структура каждого дескриптора:
 *   url       — полный URL с методом
 *   purpose   — какие данные даёт
 *   rateLimit — ограничения по документации площадки
 *   pageSize  — рекомендуемый размер страницы
 *   strategy  — FULL (каждый раз заново) | INCREMENTAL (с курсором/датой)
 *   status    — ACTIVE | MISSING (нужно добавить) | OPTIONAL
 */

// ─── OZON ─────────────────────────────────────────────────────────────────────
// Base: https://api-seller.ozon.ru
// Auth: Client-Id + Api-Key headers
// General limit: ~10 req/s per account

export const OZON_ENDPOINTS = {

  /** 1. Список product_id всех товаров продавца.
   *  Необходим как первый шаг — даёт только ID и offer_id.
   *  Cursor: last_id. Max limit: 1000. */
  PRODUCT_LIST: {
    method: "POST" as const,
    url: "https://api-seller.ozon.ru/v3/product/list",
    purpose: "Список всех товаров (ID + offer_id)",
    rateLimit: "~10 req/s",
    pageSize: 1_000,
    strategy: "FULL" as const,
    status: "ACTIVE" as const,
  },

  /** 2. Детали товаров: название, габариты (мм), вес (г), категория.
   *  Батч до 1000 product_id за вызов. Параллельно с PRODUCT_PRICES. */
  PRODUCT_INFO: {
    method: "POST" as const,
    url: "https://api-seller.ozon.ru/v3/product/info/list",
    purpose: "Название, габариты (мм→см), вес (г→кг)",
    rateLimit: "~10 req/s",
    pageSize: 1_000,
    strategy: "FULL" as const,
    status: "ACTIVE" as const,
  },

  /** 3. Цены и min-цены товаров.
   *  Cursor: last_id. Параллельно с PRODUCT_INFO. */
  PRODUCT_PRICES: {
    method: "POST" as const,
    url: "https://api-seller.ozon.ru/v4/product/info/prices",
    purpose: "Цена продажи, минимальная цена",
    rateLimit: "~10 req/s",
    pageSize: 1_000,
    strategy: "FULL" as const,
    status: "ACTIVE" as const,
  },

  /** 4. Финансовые транзакции за период.
   *  Page: page + page_size. Даёт комиссии, логистику, возвраты, выплаты.
   *  Обновляется с задержкой до 24 ч. */
  FINANCE_TRANSACTIONS: {
    method: "POST" as const,
    url: "https://api-seller.ozon.ru/v3/finance/transaction/list",
    purpose: "Продажи, комиссии, логистика, возвраты, штрафы",
    rateLimit: "~10 req/s; данные с задержкой до 24 ч",
    pageSize: 1_000,
    strategy: "INCREMENTAL" as const, // from / to date range
    status: "ACTIVE" as const,
  },

  /** 5. Остатки товаров на складах.
   *  OPTIONAL — нужен для расчёта стоимости заморозки оборотных средств. */
  PRODUCT_STOCKS: {
    method: "POST" as const,
    url: "https://api-seller.ozon.ru/v3/product/info/stocks",
    purpose: "Остатки на складах FBO/FBS",
    rateLimit: "~10 req/s",
    pageSize: 1_000,
    strategy: "FULL" as const,
    status: "OPTIONAL" as const,
  },

  /** 6. Рекламная статистика (Performance API — ДРУГОЙ хост и OAuth!).
   *  Требует отдельного client_id и access_token от Ozon Performance.
   *  Даёт расходы по кампаниям, показы, клики, CPC/CPM.
   *  MISSING — не реализовано, нужно добавить отдельный OAuth-модуль. */
  ADVERTISING_STATS: {
    method: "POST" as const,
    url: "https://performance.ozon.ru/api/client/statistics/daily",
    purpose: "Расходы на рекламу по товарам и кампаниям",
    rateLimit: "60 req/min",
    pageSize: 30, // дней за запрос
    strategy: "INCREMENTAL" as const,
    status: "MISSING" as const,
    note: "Требует отдельного OAuth: POST https://performance.ozon.ru/api/client/token",
  },

  /** 7. Отчёт по реализации (еженедельный финотчёт).
   *  Даёт итоги периода: выручка, комиссии, логистика, хранение.
   *  Альтернатива ручному финотчёту. */
  FINANCE_REALIZATION: {
    method: "POST" as const,
    url: "https://api-seller.ozon.ru/v4/finance/realization",
    purpose: "Еженедельный отчёт реализации (аналог ручного финотчёта)",
    rateLimit: "~10 req/s",
    pageSize: 1,
    strategy: "INCREMENTAL" as const,
    status: "OPTIONAL" as const,
  },

} as const;

// ─── WILDBERRIES ──────────────────────────────────────────────────────────────
// Auth: Authorization: Bearer <token>
// General limit: 300 req/60s = 5 req/s; Content: 100 req/min; Stats: очень строго
// 429: читать X-Ratelimit-Retry header

export const WB_ENDPOINTS = {

  /** 1. Карточки товаров: название, артикул, категория, габариты.
   *  Cursor: updatedAt + nmID. Max 100 за запрос.
   *  Поддерживает INCREMENTAL — передай cursor с прошлой сессии, получишь только изменения. */
  CONTENT_CARDS: {
    method: "POST" as const,
    url: "https://content-api.wildberries.ru/content/v2/get/cards/list",
    purpose: "Карточки товаров: название, vendorCode, категория, габариты",
    rateLimit: "100 req/min",
    pageSize: 100,
    strategy: "INCREMENTAL" as const, // cursor updatedAt поддерживает delta
    status: "ACTIVE" as const,
  },

  /** 2. Цены и скидки товаров — отдельный эндпоинт, точнее чем salePriceU в карточках.
   *  salePriceU в карточках = цена до скидки × 100 (копейки), часто None.
   *  Этот эндпоинт даёт актуальную цену продажи и размер скидки.
   *  MISSING — сейчас берём из карточки, что ненадёжно. */
  PRICES: {
    method: "GET" as const,
    url: "https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter",
    purpose: "Актуальные цены продажи и скидки",
    rateLimit: "100 req/min",
    pageSize: 1_000,
    strategy: "FULL" as const,
    status: "MISSING" as const,
    note: "Заменяет ненадёжный salePriceU из карточек",
  },

  /** 3. Детальный финансовый отчёт за период.
   *  Даёт ppvz_for_pay (выплата), delivery_rub, storage_fee, penalty.
   *  Cursor: rrdid. Обновляется раз в час. Max 100 000 строк за запрос.
   *  Лимит: очень строгий — фактически 1 тяжёлый запрос в ~3 мин. */
  STATS_REPORT: {
    method: "GET" as const,
    url: "https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod",
    purpose: "Продажи, выплаты, логистика, хранение, штрафы (построчно)",
    rateLimit: "1 тяжёлый запрос / ~3 мин — использовать редко",
    pageSize: 100_000,
    strategy: "INCREMENTAL" as const, // rrdid cursor
    status: "ACTIVE" as const,
  },

  /** 4. Заказы в реальном времени (FBO + FBS).
   *  Обновляются каждые 30 минут. Даёт количество заказов, finishedPrice.
   *  OPTIONAL — полезен для Модели 3 (текущий момент). */
  STATS_ORDERS: {
    method: "GET" as const,
    url: "https://statistics-api.wildberries.ru/api/v1/supplier/orders",
    purpose: "Заказы в реальном времени (для Модели 3)",
    rateLimit: "3 req/30s",
    pageSize: 500,
    strategy: "INCREMENTAL" as const, // dateFrom
    status: "OPTIONAL" as const,
  },

  /** 5. Продажи (выкупы) — отдельно от заказов.
   *  OPTIONAL — даёт точный % выкупа за период. */
  STATS_SALES: {
    method: "GET" as const,
    url: "https://statistics-api.wildberries.ru/api/v1/supplier/sales",
    purpose: "Фактические выкупы (для точного % выкупа)",
    rateLimit: "3 req/30s",
    pageSize: 500,
    strategy: "INCREMENTAL" as const,
    status: "OPTIONAL" as const,
  },

  /** 6. Рекламная статистика по кампаниям.
   *  Даёт расходы, показы, клики, корзины, заказы по каждой кампании.
   *  MISSING — не реализовано. */
  ADVERTISING_FULLSTATS: {
    method: "POST" as const,
    url: "https://advert-api.wildberries.ru/adv/v2/fullstats",
    purpose: "Расходы на рекламу, показы, клики по кампаниям",
    rateLimit: "1 req/min",
    pageSize: 100, // кампаний за запрос
    strategy: "INCREMENTAL" as const,
    status: "MISSING" as const,
  },

  /** 7. Список рекламных кампаний (нужен перед fullstats — даёт advertId).
   *  MISSING — нужен для получения списка advertId перед запросом статистики. */
  ADVERTISING_CAMPAIGNS: {
    method: "GET" as const,
    url: "https://advert-api.wildberries.ru/adv/v1/promotion/adverts",
    purpose: "Список рекламных кампаний (advertId для fullstats)",
    rateLimit: "5 req/s",
    pageSize: 50,
    strategy: "FULL" as const,
    status: "MISSING" as const,
  },

} as const;

// ─── Порядок вызовов при синхронизации ───────────────────────────────────────
//
// OZON — полная синхронизация:
//   1. PRODUCT_LIST (cursor loop)
//        └─ 2a. PRODUCT_INFO (parallel)  ← один вызов на батч 1000 ID
//           2b. PRODUCT_PRICES (parallel) ← cursor loop
//   3. FINANCE_TRANSACTIONS (page loop, date range)
//   [4. ADVERTISING_STATS — нужно добавить, отдельный OAuth]
//
// WB — полная синхронизация:
//   1. CONTENT_CARDS (cursor loop, 100/запрос)
//   [2. PRICES — нужно добавить, заменит salePriceU]
//   3. STATS_REPORT (rrdid loop, 100k/запрос, пауза 3с между стр.)
//   [4. ADVERTISING_FULLSTATS — нужно добавить]
//
// INCREMENTAL (после первой синхронизации):
//   OZON: нет нативного delta для товаров, всегда full
//   WB:   CONTENT_CARDS поддерживает cursor по updatedAt — только изменённые
//         STATS_REPORT: rrdid с позиции последней записи — только новые строки

// ─── Известные неэффективности ───────────────────────────────────────────────
//
// 1. WB товары: нет инкрементального синка — каждый раз 100 карточек/запрос
//    от нуля. FIXME: сохранять последний cursor { updatedAt, nmID } в Store.lastSyncCursor
//
// 2. WB цены: salePriceU берётся из карточек — ненадёжно (может быть null
//    или цена до скидки). FIXME: добавить PRICES endpoint.
//
// 3. Реклама: ADVERTISING_STATS (Ozon) и ADVERTISING_FULLSTATS (WB) не вызываются.
//    Без них расчёт юнит-экономики неполный (нет advertising costs).
//
// 4. OZON товары: product/list → product/info/list выполняются последовательно
//    по необходимости (list даёт ID → info нужны ID). Это нормально.
//    INFO и PRICES уже параллельные — ОК.
//
// 5. WB STATS_REPORT: лимит строк 100k, но мы запрашиваем весь период за раз.
//    При большом объёме (>100k строк) нужна rrdid-пагинация — реализована.

export type OzonEndpointKey = keyof typeof OZON_ENDPOINTS;
export type WbEndpointKey = keyof typeof WB_ENDPOINTS;
