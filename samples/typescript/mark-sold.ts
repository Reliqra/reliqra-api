/**
 * Mark an item sold and record the sale.
 *
 * Creates a sale for the item (with optional fees), then sets the item's
 * status to Sold and its sold_price. Pass --order-id to make the sale
 * idempotent: running the command again updates the same sale instead of
 * creating a duplicate.
 *
 * Scopes needed: sales:write and inventory:write
 * --dry-run fetches the item (inventory:read also needed) and prints what
 * would be sent, without making any change.
 *
 * Usage:
 *   RELIQRA_API_KEY=<your key> node mark-sold.ts <reliqra_id> --price 42.50 \
 *     [--marketplace my-site] [--order-id order-1001] [--fee processor=1.48] [--dry-run]
 * (Node 22.18+ runs .ts directly; otherwise use `npx tsx mark-sold.ts ...`.)
 */
import { parseArgs } from "node:util";
import { ReliqraClient, ReliqraConfigError, ReliqraError } from "../../sdk/typescript/dist/index.js";
import type { Fee, SaleCreate } from "../../sdk/typescript/dist/index.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    price: { type: "string" },
    marketplace: { type: "string", default: "direct" },
    "order-id": { type: "string" },
    fee: { type: "string", multiple: true },
    "dry-run": { type: "boolean", default: false },
  },
});

const id = positionals[0];
const price = Number(values.price);
if (!id || !Number.isFinite(price) || price < 0) {
  console.error("Usage: mark-sold.ts <reliqra_id> --price <amount> [--marketplace name] [--order-id id] [--fee kind=amount] [--dry-run]");
  process.exit(2);
}

const fees: Fee[] = (values.fee ?? []).map((f) => {
  const [kind, amount] = f.split("=");
  if (!kind || !Number.isFinite(Number(amount))) {
    console.error(`Bad --fee "${f}", expected kind=amount`);
    process.exit(2);
  }
  return { kind, amount: Number(amount) };
});

const sale: SaleCreate = {
  item_reliqra_id: id,
  sold_at: new Date().toISOString(),
  sold_price: price,
  marketplace: values.marketplace!,
  ...(values["order-id"] ? { marketplace_external_id: values["order-id"] } : {}),
  ...(fees.length ? { fees } : {}),
};

try {
  const client = new ReliqraClient();
  if (values["dry-run"]) {
    const item = await client.getInventoryItem(id);
    console.log(`[dry-run] Item: ${item.title ?? id} (status ${item.status})`);
    console.log("[dry-run] Would POST /sales:", JSON.stringify(sale));
    console.log("[dry-run] Would PATCH item:", JSON.stringify({ status: "Sold", sold_price: price }));
  } else {
    const recorded = await client.createSale(sale);
    const item = await client.updateInventoryItem(id, { status: "Sold", sold_price: price });
    console.log(`Recorded sale ${recorded.id}; item ${item.reliqra_id} is now ${item.status}.`);
  }
} catch (e) {
  if (e instanceof ReliqraError || e instanceof ReliqraConfigError) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
