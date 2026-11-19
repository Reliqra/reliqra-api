"""Mark an item sold and record the sale.

Creates a sale for the item (with optional fees), then sets the item's
status to Sold and its sold_price. Pass --order-id to make the sale
idempotent: running the command again updates the same sale instead of
creating a duplicate.

Scopes needed: sales:write and inventory:write
--dry-run fetches the item (inventory:read also needed) and prints what
would be sent, without making any change.

Usage:
    RELIQRA_API_KEY=<your key> python3 mark_sold.py <reliqra_id> --price 42.50 \
        [--marketplace my-site] [--order-id order-1001] [--fee processor=1.48] [--dry-run]
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "sdk", "python"))
from reliqra_api import ReliqraClient, ReliqraConfigError, ReliqraError  # noqa: E402


def parse_fee(text: str) -> dict:
    kind, _, amount = text.partition("=")
    try:
        return {"kind": kind, "amount": float(amount)}
    except ValueError:
        raise argparse.ArgumentTypeError(f"bad fee {text!r}, expected kind=amount")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("reliqra_id")
    p.add_argument("--price", type=float, required=True)
    p.add_argument("--marketplace", default="direct")
    p.add_argument("--order-id")
    p.add_argument("--fee", action="append", type=parse_fee, default=[])
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    sale = {
        "item_reliqra_id": args.reliqra_id,
        "sold_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sold_price": args.price,
        "marketplace": args.marketplace,
    }
    if args.order_id:
        sale["marketplace_external_id"] = args.order_id
    if args.fee:
        sale["fees"] = args.fee

    try:
        client = ReliqraClient()
        if args.dry_run:
            item = client.get_inventory_item(args.reliqra_id)
            print(f"[dry-run] Item: {item.get('title') or args.reliqra_id} (status {item.get('status')})")
            print("[dry-run] Would POST /sales:", json.dumps(sale))
            print("[dry-run] Would PATCH item:", json.dumps({"status": "Sold", "sold_price": args.price}))
            return 0
        recorded = client.create_sale(sale)
        item = client.update_inventory_item(args.reliqra_id, {"status": "Sold", "sold_price": args.price})
        print(f"Recorded sale {recorded.get('id')}; item {item['reliqra_id']} is now {item.get('status')}.")
    except (ReliqraError, ReliqraConfigError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
