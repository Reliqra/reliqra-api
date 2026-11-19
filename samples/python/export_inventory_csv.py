"""Export your whole inventory to a CSV file.

Follows pagination until every item has been read, then writes one row per
item. Common fields come first; any other scalar fields your items carry
(coin, card, comic and gem specifics) are added as extra columns, and
`record_extras` is written as a JSON string.

Scopes needed: inventory:read
This sample only reads. --dry-run prints the row count and columns without
writing the file.

Usage:
    RELIQRA_API_KEY=<your key> python3 export_inventory_csv.py [--out inventory.csv] [--status Active] [--dry-run]
"""
import argparse
import csv
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "sdk", "python"))
from reliqra_api import ReliqraClient, ReliqraConfigError, ReliqraError  # noqa: E402

CORE = [
    "reliqra_id", "title", "status", "product_type", "quantity", "quantity_available",
    "value", "cost", "sold_price", "sold_at", "created_at", "last_modified_at",
]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out", default="inventory.csv")
    p.add_argument("--status", choices=["Active", "Sold", "Traded", "Private"])
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    try:
        client = ReliqraClient()
        params = {"limit": 500}
        if args.status:
            params["status"] = args.status
        items = list(client.iterate_inventory(**params))
    except (ReliqraError, ReliqraConfigError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    extra = sorted({k for i in items for k in i if k not in CORE and not k.endswith("_photo_url")})
    columns = CORE + extra

    if args.dry_run:
        print(f"[dry-run] {len(items)} items, {len(columns)} columns. Would write {args.out}.")
        return 0

    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(columns)
        for item in items:
            w.writerow([
                json.dumps(v) if isinstance(v, (dict, list)) else ("" if v is None else v)
                for v in (item.get(c) for c in columns)
            ])
    print(f"Wrote {len(items)} items to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
