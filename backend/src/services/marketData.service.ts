import { prisma } from "../db.js";
import { Decimal } from "../lib/decimal.js";

/**
 * Datos de mercado: actualiza el valor liquidativo (`currentNAV`) de los fondos con ticker consultando la API
 * pública de Yahoo Finance.
 *
 * Estrategia de caché y recuperación (la aplicación nunca debe romperse por un fallo del proveedor):
 *  - Caché con TTL: un precio se considera vigente durante `ttlMs` desde `lastPriceUpdate`. Mientras tanto no se
 *    consulta la API, aunque se pida el catálogo o la cartera continuamente.
 *  - Si la API responde, se guarda el precio y la hora en PostgreSQL.
 *  - Si falla (límite de cuota, sin conexión, timeout, respuesta no válida…), el error se captura, NO se modifica
 *    la base de datos y las consultas siguen devolviendo la última cotización guardada.
 *  - Tras un fallo, ese fondo no se vuelve a consultar durante `failureCooldownMs`, para no añadir latencia a cada
 *    petición cuando el proveedor está caído.
 *  - Las consultas de un mismo ciclo se hacen en paralelo y con timeout, por lo que el retraso máximo es `timeoutMs`.
 */

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

export type FundSyncStatus = "updated" | "failed" | "skipped";
export type SkipReason = "no-ticker" | "fresh" | "cooldown";
export type FailureReason = "http" | "timeout" | "network" | "invalid" | "currency" | "database";

export interface FundSyncResult {
  fundId: string;
  isin: string;
  ticker: string | null;
  status: FundSyncStatus;
  /** Nuevo NAV, solo si `status` es `updated`. */
  price?: number;
  reason?: SkipReason | FailureReason;
  detail?: string;
}

export interface SyncSummary {
  total: number;
  updated: number;
  failed: number;
  skipped: number;
  syncedAt: string;
  results: FundSyncResult[];
}

export interface Quote {
  price: number;
  currency: string;
}

export class QuoteError extends Error {
  constructor(
    public reason: Exclude<FailureReason, "database">,
    message: string,
  ) {
    super(message);
    this.name = "QuoteError";
  }
}

export interface FetchQuoteOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

/** Consulta la cotización actual de un ticker. Lanza `QuoteError` ante cualquier problema. */
export async function fetchQuote(ticker: string, options: FetchQuoteOptions = {}): Promise<Quote> {
  const { fetchImpl = fetch, timeoutMs = 3000, baseUrl = YAHOO_CHART_URL } = options;
  const url = `${baseUrl}${encodeURIComponent(ticker)}?range=1d&interval=1d`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GestorCarteras/1.0)", Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new QuoteError("timeout", `Sin respuesta en ${timeoutMs} ms`);
    }
    throw new QuoteError("network", err instanceof Error ? err.message : "Error de red");
  }

  if (!res.ok) throw new QuoteError("http", `El proveedor respondió HTTP ${res.status}`);

  let body: { chart?: { result?: { meta?: { regularMarketPrice?: unknown; currency?: unknown } }[] } };
  try {
    body = await res.json();
  } catch {
    throw new QuoteError("invalid", "Respuesta no válida (JSON incorrecto)");
  }

  const meta = body?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new QuoteError("invalid", "La respuesta no contiene un precio válido");
  }
  // Toda la aplicación trabaja en euros: una cotización en otra divisa daría un NAV incorrecto.
  if (meta?.currency !== "EUR") {
    throw new QuoteError("currency", `Divisa no soportada: ${String(meta?.currency)}`);
  }
  return { price, currency: "EUR" };
}

/** Subconjunto de la tabla `Fund` que necesita el servicio (facilita sustituirla en los tests). */
export interface FundRow {
  id: string;
  isin: string;
  ticker: string | null;
  currentNAV: Decimal;
  lastPriceUpdate: Date | null;
}

export interface MarketDb {
  fund: {
    findMany(): Promise<FundRow[]>;
    update(args: { where: { id: string }; data: { currentNAV: Decimal; lastPriceUpdate: Date } }): Promise<unknown>;
  };
}

export interface MarketDataOptions {
  db: MarketDb;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Si es false, `refreshIfStale` no hace nada y `syncPrices` no debe invocarse desde la API. */
  enabled?: boolean;
  /** Vigencia de un precio. Por defecto, 15 minutos. */
  ttlMs?: number;
  /** Timeout de cada consulta externa. Por defecto, 3 segundos. */
  timeoutMs?: number;
  /** Espera antes de reintentar un fondo cuya consulta falló. Por defecto, 5 minutos. */
  failureCooldownMs?: number;
  /** Consultas simultáneas máximas. Por defecto, 12. */
  concurrency?: number;
  baseUrl?: string;
  log?: (message: string) => void;
}

export function createMarketDataService(options: MarketDataOptions) {
  const {
    db,
    fetchImpl,
    now = () => new Date(),
    enabled = true,
    ttlMs = 15 * 60_000,
    timeoutMs = 3000,
    failureCooldownMs = 5 * 60_000,
    concurrency = 12,
    baseUrl,
    log = () => {},
  } = options;

  const cooldownUntil = new Map<string, number>();
  let inflight: { promise: Promise<SyncSummary>; force: boolean } | null = null;

  async function syncOne(fund: FundRow & { ticker: string }): Promise<FundSyncResult> {
    const base = { fundId: fund.id, isin: fund.isin, ticker: fund.ticker };
    try {
      const quote = await fetchQuote(fund.ticker, { fetchImpl, timeoutMs, baseUrl });
      const nav = new Decimal(quote.price.toFixed(4));
      await db.fund.update({ where: { id: fund.id }, data: { currentNAV: nav, lastPriceUpdate: now() } });
      cooldownUntil.delete(fund.id);
      return { ...base, status: "updated", price: nav.toNumber() };
    } catch (err) {
      // Cualquier fallo se captura: la BD conserva la última cotización y la app sigue funcionando.
      cooldownUntil.set(fund.id, now().getTime() + failureCooldownMs);
      const reason: FailureReason = err instanceof QuoteError ? err.reason : "database";
      const detail = err instanceof Error ? err.message : String(err);
      return { ...base, status: "failed", reason, detail };
    }
  }

  async function run(force: boolean): Promise<SyncSummary> {
    const funds = await db.fund.findMany();
    const clock = now().getTime();
    const results: FundSyncResult[] = new Array(funds.length);
    const pending: { index: number; fund: FundRow & { ticker: string } }[] = [];

    funds.forEach((fund, index) => {
      const base = { fundId: fund.id, isin: fund.isin, ticker: fund.ticker };
      if (!fund.ticker) {
        results[index] = { ...base, status: "skipped", reason: "no-ticker" };
      } else if (!force && fund.lastPriceUpdate && clock - fund.lastPriceUpdate.getTime() < ttlMs) {
        results[index] = { ...base, status: "skipped", reason: "fresh" };
      } else if (!force && (cooldownUntil.get(fund.id) ?? 0) > clock) {
        results[index] = { ...base, status: "skipped", reason: "cooldown" };
      } else {
        pending.push({ index, fund: fund as FundRow & { ticker: string } });
      }
    });

    // Pequeño "pool" de trabajadores: hasta `concurrency` consultas a la vez.
    let next = 0;
    const worker = async () => {
      while (next < pending.length) {
        const item = pending[next++];
        results[item.index] = await syncOne(item.fund);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));

    const count = (s: FundSyncStatus) => results.filter((r) => r.status === s).length;
    const summary: SyncSummary = {
      total: funds.length,
      updated: count("updated"),
      failed: count("failed"),
      skipped: count("skipped"),
      syncedAt: now().toISOString(),
      results,
    };
    if (summary.failed > 0) {
      const sample = results.find((r) => r.status === "failed");
      log(`${summary.failed} de ${pending.length} consultas fallaron (p. ej. ${sample?.ticker}: ${sample?.detail}); se mantienen los últimos precios guardados`);
    }
    return summary;
  }

  /**
   * Actualiza los precios. Con `force` ignora la vigencia y el periodo de espera (actualización manual).
   * Las llamadas simultáneas comparten la misma ejecución.
   */
  async function syncPrices({ force = false }: { force?: boolean } = {}): Promise<SyncSummary> {
    if (inflight && (inflight.force || !force)) return inflight.promise;
    if (inflight) {
      // Hay una sincronización no forzada en curso y se pide una forzada: se espera y se vuelve a lanzar.
      await inflight.promise.catch(() => {});
      return syncPrices({ force });
    }
    const promise = run(force).finally(() => {
      inflight = null;
    });
    inflight = { promise, force };
    return promise;
  }

  /** Para las rutas de lectura: refresca solo lo caducado y NUNCA lanza, pase lo que pase. */
  async function refreshIfStale(): Promise<void> {
    if (!enabled) return;
    try {
      await syncPrices();
    } catch (err) {
      log(`No se pudo actualizar los precios: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { enabled, syncPrices, refreshIfStale, fetchQuote: (ticker: string) => fetchQuote(ticker, { fetchImpl, timeoutMs, baseUrl }) };
}

export type MarketDataService = ReturnType<typeof createMarketDataService>;

const envNumber = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** Instancia de la aplicación, configurada con variables de entorno (ver README). */
export const marketData = createMarketDataService({
  db: prisma as unknown as MarketDb,
  enabled: process.env.MARKET_DATA_ENABLED !== "false",
  ttlMs: envNumber("MARKET_DATA_TTL_MINUTES", 15) * 60_000,
  timeoutMs: envNumber("MARKET_DATA_TIMEOUT_MS", 3000),
  log: (message) => console.warn(`[marketData] ${message}`),
});
