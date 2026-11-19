import { ReliqraConfigError, errorFromResponse } from "./errors.js";
import type {
  ApiEvent,
  InventoryItem,
  InventoryPatch,
  ListEventsParams,
  ListInventoryParams,
  ListParams,
  ListSalesParams,
  Page,
  Sale,
  SaleCreate,
  Shipment,
  WriteOptions,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://api.reliqra.com/v1";

export interface ClientOptions {
  /** API key. Falls back to the RELIQRA_API_KEY environment variable. */
  apiKey?: string;
  /** Override the base URL. Defaults to the production API. */
  baseUrl?: string;
  /** Retries after the first attempt for 429 and retryable 5xx. Default 3. */
  maxRetries?: number;
  /** Custom fetch implementation, for tests or proxies. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Custom sleep, for tests. Receives milliseconds. */
  sleep?: (ms: number) => Promise<void>;
}

type Query = Record<string, string | number | undefined>;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function iso(v: string | Date | undefined): string | undefined {
  return v instanceof Date ? v.toISOString() : v;
}

export class ReliqraClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ClientOptions = {}) {
    const key =
      options.apiKey ??
      (typeof process !== "undefined" ? process.env?.["RELIQRA_API_KEY"] : undefined);
    if (!key) {
      throw new ReliqraConfigError(
        "No API key. Pass { apiKey } or set the RELIQRA_API_KEY environment variable.",
      );
    }
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetch ?? ((...a) => globalThis.fetch(...a));
    this.sleep = options.sleep ?? defaultSleep;
  }

  // ---- Inventory -------------------------------------------------------

  listInventory(params: ListInventoryParams = {}): Promise<Page<InventoryItem>> {
    return this.request("GET", "/inventory", {
      query: {
        limit: params.limit,
        cursor: params.cursor,
        status: params.status,
        updated_after: iso(params.updated_after),
      },
    });
  }

  /** Async iterator over every matching item, following pagination. */
  iterateInventory(params: ListInventoryParams = {}): AsyncGenerator<InventoryItem> {
    return this.paginate((cursor) => this.listInventory({ ...params, cursor }), params.cursor);
  }

  getInventoryItem(reliqraId: string): Promise<InventoryItem> {
    return this.request("GET", `/inventory/${encodeURIComponent(reliqraId)}`);
  }

  updateInventoryItem(
    reliqraId: string,
    patch: InventoryPatch,
    options: WriteOptions = {},
  ): Promise<InventoryItem> {
    return this.request("PATCH", `/inventory/${encodeURIComponent(reliqraId)}`, {
      body: patch,
      idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
    });
  }

  /**
   * Returns the short-lived signed URL for an item photo (the API answers 302).
   * The URL expires after about ten minutes; do not store it.
   */
  async getItemImageUrl(reliqraId: string, side: "front" | "back"): Promise<string> {
    const res = await this.send("GET", `/items/${encodeURIComponent(reliqraId)}/image/${side}`, {
      redirect: "manual",
    });
    const location = res.headers.get("location");
    if (!location) {
      throw errorFromResponse(res.status, null, undefined);
    }
    return location;
  }

  // ---- Sales -----------------------------------------------------------

  listSales(params: ListSalesParams = {}): Promise<Page<Sale>> {
    return this.request("GET", "/sales", {
      query: { limit: params.limit, cursor: params.cursor, since: iso(params.since) },
    });
  }

  iterateSales(params: ListSalesParams = {}): AsyncGenerator<Sale> {
    return this.paginate((cursor) => this.listSales({ ...params, cursor }), params.cursor);
  }

  createSale(sale: SaleCreate, options: WriteOptions = {}): Promise<Sale> {
    return this.request("POST", "/sales", {
      body: sale,
      idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
    });
  }

  // ---- Shipments -------------------------------------------------------

  listShipments(params: ListParams = {}): Promise<Page<Shipment>> {
    return this.request("GET", "/shipments", {
      query: { limit: params.limit, cursor: params.cursor },
    });
  }

  iterateShipments(params: ListParams = {}): AsyncGenerator<Shipment> {
    return this.paginate((cursor) => this.listShipments({ ...params, cursor }), params.cursor);
  }

  // ---- Events ----------------------------------------------------------

  listEvents(params: ListEventsParams = {}): Promise<Page<ApiEvent>> {
    return this.request("GET", "/events", { query: { limit: params.limit, after: params.after } });
  }

  /**
   * Async iterator over events, oldest first, until caught up. The events
   * feed pages with `after`; `next_cursor` is the last event id on a full page.
   */
  async *iterateEvents(params: ListEventsParams = {}): AsyncGenerator<ApiEvent> {
    let after = params.after ?? 0;
    for (;;) {
      const page = await this.listEvents({ ...params, after });
      for (const e of page.data) yield e;
      if (!page.next_cursor) return;
      const next = Number(page.next_cursor);
      if (!Number.isFinite(next) || next <= after) return;
      after = next;
    }
  }

  // ---- Internals -------------------------------------------------------

  private async *paginate<T>(
    fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
    start: string | undefined,
  ): AsyncGenerator<T> {
    let cursor = start;
    for (;;) {
      const page = await fetchPage(cursor);
      for (const item of page.data) yield item;
      if (!page.next_cursor) return;
      cursor = page.next_cursor;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const res = await this.send(method, path, opts);
    return (await res.json()) as T;
  }

  /** Sends a request with retry. Returns only successful (or manual-redirect) responses. */
  private async send(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown; idempotencyKey?: string; redirect?: RequestRedirect },
  ): Promise<Response> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      "X-Reliqra-Api-Key": this.apiKey,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    // 5xx retries are only safe for reads and for writes that carry an idempotency key.
    const retry5xx = method === "GET" || opts.idempotencyKey !== undefined;

    for (let attempt = 0; ; attempt++) {
      const init: RequestInit = { method, headers };
      if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
      if (opts.redirect) init.redirect = opts.redirect;
      const res = await this.fetchImpl(url, init);

      if (res.ok || (opts.redirect === "manual" && res.status >= 300 && res.status < 400)) {
        return res;
      }

      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfter =
        retryAfterHeader !== null && /^\d+(\.\d+)?$/.test(retryAfterHeader.trim())
          ? Number(retryAfterHeader)
          : undefined;
      const retryable = res.status === 429 || (res.status >= 500 && retry5xx);
      if (retryable && attempt < this.maxRetries) {
        await res.text().catch(() => "");
        const backoff = Math.min(500 * 2 ** attempt, 30_000);
        await this.sleep(retryAfter !== undefined ? retryAfter * 1000 : backoff);
        continue;
      }

      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      throw errorFromResponse(res.status, body, retryAfter);
    }
  }
}
