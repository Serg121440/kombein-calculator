/**
 * Server-only HTTP client.
 * Features: timeout via AbortController, exponential backoff retry,
 * 429-aware waiting (Retry-After / X-Ratelimit-Retry headers).
 */

export interface FetchOpts {
  timeoutMs?: number;
  maxRetries?: number;
  label?: string;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wraps fetch with timeout, retry, and 429 back-off. Always resolves to a Response. */
export async function apiFetch(
  url: string,
  init: RequestInit,
  opts: FetchOpts = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT,
    maxRetries = DEFAULT_RETRIES,
    label = url.replace(/^https?:\/\/[^/]+/, ""),
  } = opts;

  let lastRes: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (!RETRY_STATUSES.has(res.status)) {
        return res;
      }

      lastRes = res;

      // 429: honour the API's requested wait time
      if (res.status === 429) {
        const retryHeader =
          res.headers.get("X-Ratelimit-Retry") ??
          res.headers.get("Retry-After") ??
          "0";
        const headerSec = parseInt(retryHeader, 10) || 0;
        const backoffMs = Math.max(headerSec * 1000, 2 ** attempt * 1_000);
        console.warn(
          `[api] ${label} → 429, waiting ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`,
        );
        if (attempt < maxRetries) await sleep(backoffMs);
        continue;
      }

      // 5xx: exponential backoff
      const backoffMs = 2 ** attempt * 1_000;
      console.warn(
        `[api] ${label} → ${res.status}, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`,
      );
      if (attempt < maxRetries) await sleep(backoffMs);
    } catch (err) {
      clearTimeout(timer);
      const e = err as Error;
      if (e.name === "AbortError") {
        throw new Error(`[api] ${label} timed out after ${timeoutMs}ms`);
      }
      if (attempt < maxRetries) {
        const backoffMs = 2 ** attempt * 1_000;
        const cause = (e as NodeJS.ErrnoException).code ?? (e.cause as Error | undefined)?.message ?? "";
        console.warn(`[api] ${label} → network error, retrying in ${backoffMs}ms: ${e.message}${cause ? ` (${cause})` : ""}`);
        await sleep(backoffMs);
      } else {
        const cause = (e as NodeJS.ErrnoException).code ?? (e.cause as Error | undefined)?.message ?? "";
        throw new Error(`[api] ${label} fetch failed${cause ? `: ${cause}` : ""}`, { cause: e });
      }
    }
  }

  // Return last known response (caller checks res.ok)
  if (lastRes) return lastRes;
  throw new Error(`[api] ${label} failed after ${maxRetries + 1} attempts`);
}

/** Parse JSON from a Response; throws with readable message on HTTP error or bad JSON. */
export async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    // Try to extract a human-readable message from JSON error bodies
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      const msg =
        (body.message as string) ??
        (body.error as string) ??
        (body.errorText as string) ??
        (body.detail as string) ??
        text.slice(0, 300);
      throw new Error(`[${res.status}] ${msg}`);
    } catch (e) {
      if ((e as Error).message.startsWith("[")) throw e;
      throw new Error(`[${res.status}] ${text.slice(0, 300)}`);
    }
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Некорректный JSON от сервера (${res.status}): ${text.slice(0, 200)}`);
  }
}
