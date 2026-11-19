/**
 * "What changed since yesterday" report.
 *
 * Lists inventory items modified since a point in time (default: 24 hours
 * ago, using the updated_after filter) and sales recorded since then.
 * Prints a short summary. Read-only, so --dry-run is accepted and behaves the
 * same: this sample never writes.
 *
 * Scopes needed: inventory:read and sales:read
 *
 * Usage:
 *   RELIQRA_API_KEY=<your key> node what-changed.ts [--since 2026-01-15T00:00:00Z] [--dry-run]
 * (Node 22.18+ runs .ts directly; otherwise use `npx tsx what-changed.ts`.)
 */
import { parseArgs } from "node:util";
import { ReliqraClient, ReliqraConfigError, ReliqraError } from "../../sdk/typescript/dist/index.js";

const { values } = parseArgs({
  options: { since: { type: "string" }, "dry-run": { type: "boolean", default: false } },
});

const since = values.since ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();

try {
  const client = new ReliqraClient();
  console.log(`Changes since ${since}${values["dry-run"] ? " (dry run: read-only anyway)" : ""}\n`);

  const byStatus = new Map<string, number>();
  let changed = 0;
  for await (const item of client.iterateInventory({ updated_after: since })) {
    changed++;
    byStatus.set(item.status ?? "unknown", (byStatus.get(item.status ?? "unknown") ?? 0) + 1);
    console.log(`  ${item.last_modified_at ?? ""}  ${item.status ?? ""}  ${item.title ?? item.reliqra_id}`);
  }
  console.log(`\nInventory items changed: ${changed}`);
  for (const [s, n] of byStatus) console.log(`  ${s}: ${n}`);

  let sales = 0;
  let revenue = 0;
  for await (const sale of client.iterateSales({ since })) {
    sales++;
    revenue += sale.sold_price ?? 0;
  }
  console.log(`\nSales recorded: ${sales}, total ${revenue.toFixed(2)}`);
} catch (e) {
  if (e instanceof ReliqraError || e instanceof ReliqraConfigError) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
