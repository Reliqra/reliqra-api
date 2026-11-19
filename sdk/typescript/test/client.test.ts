import { test } from "node:test";
import assert from "node:assert/strict";
import { ReliqraClient, ReliqraError, ReliqraConfigError } from "../src/index.js";

const KEY = "rqk_test_0000000000000000000000000000000000000000";

type Call = { url: URL; init: RequestInit };
function mock(responses: Array<Response | (() => Response)>) {
  const calls: Call[] = [];
  const f = (async (input: URL | string, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), init });
    const r = responses.shift();
    if (!r) throw new Error("no more mock responses");
    return typeof r === "function" ? r() : r;
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const noSleep = () => Promise.resolve();
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];

test("requires an API key", () => {
  const prev = process.env["RELIQRA_API_KEY"];
  delete process.env["RELIQRA_API_KEY"];
  try {
    assert.throws(() => new ReliqraClient(), ReliqraConfigError);
  } finally {
    if (prev !== undefined) process.env["RELIQRA_API_KEY"] = prev;
  }
});

test("reads the key from the environment", async () => {
  process.env["RELIQRA_API_KEY"] = KEY;
  try {
    const { f, calls } = mock([json({ data: [], next_cursor: null })]);
    await new ReliqraClient({ fetch: f }).listInventory();
    assert.equal(hdr(calls[0]!, "X-Reliqra-Api-Key"), KEY);
  } finally {
    delete process.env["RELIQRA_API_KEY"];
  }
});

test("listInventory sends filters and the key header", async () => {
  const { f, calls } = mock([json({ data: [{ reliqra_id: "a" }], next_cursor: null })]);
  const c = new ReliqraClient({ apiKey: KEY, fetch: f });
  const page = await c.listInventory({
    status: "Active",
    limit: 50,
    updated_after: new Date("2026-01-01T00:00:00Z"),
  });
  assert.equal(page.data[0]?.reliqra_id, "a");
  const u = calls[0]!.url;
  assert.equal(u.origin + u.pathname, "https://api.reliqra.com/v1/inventory");
  assert.equal(u.searchParams.get("status"), "Active");
  assert.equal(u.searchParams.get("limit"), "50");
  assert.equal(u.searchParams.get("updated_after"), "2026-01-01T00:00:00.000Z");
  assert.equal(hdr(calls[0]!, "X-Reliqra-Api-Key"), KEY);
});

test("iterateInventory follows next_cursor", async () => {
  const { f, calls } = mock([
    json({ data: [{ reliqra_id: "a" }, { reliqra_id: "b" }], next_cursor: "c1" }),
    json({ data: [{ reliqra_id: "c" }], next_cursor: null }),
  ]);
  const ids: string[] = [];
  for await (const item of new ReliqraClient({ apiKey: KEY, fetch: f }).iterateInventory()) {
    ids.push(item.reliqra_id);
  }
  assert.deepEqual(ids, ["a", "b", "c"]);
  assert.equal(calls[1]!.url.searchParams.get("cursor"), "c1");
});

test("iterateEvents pages with after", async () => {
  const { f, calls } = mock([
    json({ data: [{ id: 1, type: "x", occurred_at: "t" }, { id: 2, type: "x", occurred_at: "t" }], next_cursor: "2" }),
    json({ data: [{ id: 3, type: "x", occurred_at: "t" }], next_cursor: null }),
  ]);
  const ids: number[] = [];
  for await (const e of new ReliqraClient({ apiKey: KEY, fetch: f }).iterateEvents()) ids.push(e.id);
  assert.deepEqual(ids, [1, 2, 3]);
  assert.equal(calls[1]!.url.searchParams.get("after"), "2");
});

test("updateInventoryItem sends PATCH with body, explicit null and an idempotency key", async () => {
  const { f, calls } = mock([json({ reliqra_id: "a", status: "Sold" })]);
  const c = new ReliqraClient({ apiKey: KEY, fetch: f });
  await c.updateInventoryItem("a", { status: "Sold", cost: null });
  assert.equal(calls[0]!.init.method, "PATCH");
  assert.equal(calls[0]!.init.body, '{"status":"Sold","cost":null}');
  assert.match(hdr(calls[0]!, "Idempotency-Key") ?? "", /^[0-9a-f-]{36}$/);
});

test("createSale posts the sale", async () => {
  const { f, calls } = mock([json({ id: "s1" }, 201)]);
  const sale = await new ReliqraClient({ apiKey: KEY, fetch: f }).createSale(
    {
      item_reliqra_id: "a",
      sold_at: "2026-01-15T18:30:00Z",
      sold_price: 42.5,
      marketplace: "my-site",
      fees: [{ kind: "processor", amount: 1.48 }],
    },
    { idempotencyKey: "11111111-1111-4111-8111-111111111111" },
  );
  assert.equal(sale.id, "s1");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(hdr(calls[0]!, "Idempotency-Key"), "11111111-1111-4111-8111-111111111111");
});

test("getItemImageUrl returns the redirect location", async () => {
  const { f, calls } = mock([
    new Response(null, { status: 302, headers: { location: "https://example.invalid/signed" } }),
  ]);
  const url = await new ReliqraClient({ apiKey: KEY, fetch: f }).getItemImageUrl("a", "front");
  assert.equal(url, "https://example.invalid/signed");
  assert.equal(calls[0]!.init.redirect, "manual");
  assert.equal(calls[0]!.url.pathname, "/v1/items/a/image/front");
});

test("errors carry the API error code", async () => {
  const { f } = mock([
    json({ error: { code: "plan_required", message: "Reliqra Pro required", detail: null } }, 403),
  ]);
  await assert.rejects(new ReliqraClient({ apiKey: KEY, fetch: f }).listSales(), (e: unknown) => {
    assert.ok(e instanceof ReliqraError);
    assert.equal(e.code, "plan_required");
    assert.equal(e.status, 403);
    return true;
  });
});

test("missing_scope and validation detail surface", async () => {
  const { f } = mock([
    json({ error: { code: "validation_error", message: "bad", detail: { quantity: "must be >= 1" } } }, 422),
  ]);
  await assert.rejects(
    new ReliqraClient({ apiKey: KEY, fetch: f }).updateInventoryItem("a", { quantity: 0 }),
    (e: unknown) => e instanceof ReliqraError && e.code === "validation_error" && (e.detail as any).quantity !== undefined,
  );
});

test("429 retries honoring Retry-After", async () => {
  const { f, calls } = mock([
    json({ error: { code: "rate_limited", message: "slow" } }, 429, { "retry-after": "7" }),
    json({ data: [], next_cursor: null }),
  ]);
  const waits: number[] = [];
  const c = new ReliqraClient({ apiKey: KEY, fetch: f, sleep: async (ms) => void waits.push(ms) });
  await c.listInventory();
  assert.deepEqual(waits, [7000]);
  assert.equal(calls.length, 2);
});

test("429 without Retry-After uses backoff, and gateway body maps to rate_limited", async () => {
  const gw = () => json({ message: "Too Many Requests" }, 429);
  const { f, calls } = mock([gw, gw, gw]);
  const waits: number[] = [];
  const c = new ReliqraClient({ apiKey: KEY, fetch: f, maxRetries: 2, sleep: async (ms) => void waits.push(ms) });
  await assert.rejects(c.listInventory(), (e: unknown) => e instanceof ReliqraError && e.code === "rate_limited");
  assert.deepEqual(waits, [500, 1000]);
  assert.equal(calls.length, 3);
});

test("5xx retries for GET", async () => {
  const { f, calls } = mock([
    json({ error: { code: "upstream_error", message: "x" } }, 502),
    json({ data: [], next_cursor: null }),
  ]);
  await new ReliqraClient({ apiKey: KEY, fetch: f, sleep: noSleep }).listInventory();
  assert.equal(calls.length, 2);
});

test("4xx other than 429 does not retry", async () => {
  const { f, calls } = mock([json({ error: { code: "not_found", message: "no" } }, 404)]);
  await assert.rejects(new ReliqraClient({ apiKey: KEY, fetch: f, sleep: noSleep }).getInventoryItem("zzz"));
  assert.equal(calls.length, 1);
});
