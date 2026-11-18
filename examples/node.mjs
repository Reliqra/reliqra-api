// List all inventory, following pagination. Node.js 18+ (built-in fetch).
// Usage: RELIQRA_API_KEY=<your key> node node.mjs
const BASE = "https://api.reliqra.com/v1";
const key = process.env.RELIQRA_API_KEY;
if (!key) {
  console.error("Set RELIQRA_API_KEY to your API key");
  process.exit(1);
}

async function get(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "X-Reliqra-Api-Key": key } });
  const body = await res.json();
  if (!res.ok) {
    const { code, message } = body.error ?? {};
    throw new Error(`${res.status} ${code}: ${message}`);
  }
  return body;
}

let cursor = null;
do {
  const page = await get("/inventory", { limit: "100", cursor });
  for (const item of page.data) console.log(item.reliqra_id, item.status, item.title);
  cursor = page.next_cursor;
} while (cursor);
