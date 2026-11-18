"""List all inventory, following pagination. Python 3, standard library only.

Usage: RELIQRA_API_KEY=<your key> python3 python.py
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.reliqra.com/v1"
KEY = os.environ.get("RELIQRA_API_KEY")
if not KEY:
    sys.exit("Set RELIQRA_API_KEY to your API key")


def get(path, **params):
    query = urllib.parse.urlencode({k: v for k, v in params.items() if v})
    req = urllib.request.Request(
        f"{BASE}{path}?{query}", headers={"X-Reliqra-Api-Key": KEY}
    )
    try:
        with urllib.request.urlopen(req) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        err = json.load(e).get("error", {})
        sys.exit(f"{e.code} {err.get('code')}: {err.get('message')}")


cursor = None
while True:
    page = get("/inventory", limit=100, cursor=cursor)
    for item in page["data"]:
        print(item["reliqra_id"], item.get("status"), item.get("title"))
    cursor = page["next_cursor"]
    if not cursor:
        break
