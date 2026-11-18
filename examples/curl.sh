#!/usr/bin/env bash
# List all inventory, following pagination. Needs curl and jq.
# Usage: RELIQRA_API_KEY=<your key> ./curl.sh
set -euo pipefail

: "${RELIQRA_API_KEY:?Set RELIQRA_API_KEY to your API key}"
BASE="https://api.reliqra.com/v1"
cursor=""

while :; do
  url="$BASE/inventory?limit=100"
  [ -n "$cursor" ] && url="$url&cursor=$cursor"

  body=$(curl -sS --fail-with-body "$url" -H "X-Reliqra-Api-Key: $RELIQRA_API_KEY")
  echo "$body" | jq -r '.data[] | [.reliqra_id, .status, .title] | @tsv'

  cursor=$(echo "$body" | jq -r '.next_cursor // empty')
  [ -z "$cursor" ] && break
done
