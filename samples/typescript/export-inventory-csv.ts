/**
 * Export your whole inventory to a CSV file.
 *
 * Follows pagination until every item has been read, then writes one row per
 * item. Common fields come first; any other scalar fields your items carry
 * (coin, card, comic and gem specifics) are added as extra columns, and
 * `record_extras` is written as a JSON string.
 *
 * Scopes needed: inventory:read
 * This sample only reads. --dry-run prints the row count and columns without
 * writing the file.
 *
 * Usage:
 *   RELIQRA_API_KEY=<your key> node export-inventory-csv.ts [--out inventory.csv] [--status Active] [--dry-run]
 * (Node 22.18+ runs .ts directly; otherwise use `npx tsx export-inventory-csv.ts`.)
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ReliqraClient, ReliqraConfigError, ReliqraError } from "../../sdk/typescript/dist/index.js";
import type { InventoryItem, SettableStatus } from "../../sdk/typescript/dist/index.js";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "inventory.csv" },
    status: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const CORE = [
  "reliqra_id", "title", "status", "product_type", "quantity", "quantity_available",
  "value", "cost", "sold_price", "sold_at", "created_at", "last_modified_at",
];

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

try {
  const client = new ReliqraClient();
  const items: InventoryItem[] = [];
  for await (const item of client.iterateInventory({
    limit: 500,
    ...(values.status ? { status: values.status as SettableStatus } : {}),
  })) {
    items.push(item);
  }

  const extra = new Set<string>();
  for (const item of items) {
    for (const [k, v] of Object.entries(item)) {
      if (!CORE.includes(k) && !k.endsWith("_photo_url")) extra.add(k);
      void v;
    }
  }
  const columns = [...CORE, ...[...extra].sort()];

  if (values["dry-run"]) {
    console.log(`[dry-run] ${items.length} items, ${columns.length} columns. Would write ${values.out}.`);
  } else {
    const lines = [columns.map(cell).join(",")];
    for (const item of items) lines.push(columns.map((c) => cell(item[c])).join(","));
    writeFileSync(values.out!, lines.join("\n") + "\n", "utf8");
    console.log(`Wrote ${items.length} items to ${values.out}`);
  }
} catch (e) {
  if (e instanceof ReliqraError || e instanceof ReliqraConfigError) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
