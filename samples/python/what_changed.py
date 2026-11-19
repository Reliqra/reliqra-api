"""A "what changed since yesterday" report.

Lists inventory items modified since a point in time (default: 24 hours
ago, using the updated_after filter) and sales recorded since then.
Prints a short summary. Read-only, so --dry-run is accepted and behaves the
same: this sample never writes.

Scopes needed: inventory:read and sales:read

Usage:
    RELIQRA_API_KEY=<your key> python3 what_changed.py [--since 2026-01-15T00:00:00Z] [--dry-run]
"""
import argparse
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "sdk", "python"))
from reliqra_api import ReliqraClient, ReliqraConfigError, ReliqraError  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--since")
    p.add_argument("--dry-run", action="store_true", help="accepted for consistency; this sample never writes")
    args = p.parse_args()

    since = args.since or (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat().replace("+00:00", "Z")
    try:
        client = ReliqraClient()
        print(f"Changes since {since}\n")
        by_status = Counter()
        changed = 0
        for item in client.iterate_inventory(updated_after=since):
            changed += 1
            by_status[item.get("status") or "unknown"] += 1
            print(f"  {item.get('last_modified_at', '')}  {item.get('status', '')}  {item.get('title') or item['reliqra_id']}")
        print(f"\nInventory items changed: {changed}")
        for status, n in by_status.items():
            print(f"  {status}: {n}")

        sales = 0
        revenue = 0.0
        for sale in client.iterate_sales(since=since):
            sales += 1
            revenue += sale.get("sold_price") or 0
        print(f"\nSales recorded: {sales}, total {revenue:.2f}")
    except (ReliqraError, ReliqraConfigError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
