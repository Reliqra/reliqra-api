<p align="center">
  <a href="https://reliqra.com">
    <img src="https://reliqra.com/assets/email/wordmark-480.png" alt="Reliqra" width="280">
  </a>
</p>

# Reliqra API

Read and update your Reliqra inventory, record sales and read shipments from your own code. The API works on the same records used by the Reliqra apps, browser extension and Cloud, across coins, currency, cards, comics, bullion and gems.

- **Base URL:** `https://api.reliqra.com/v1`
- **Format:** JSON over HTTPS
- **Auth:** an API key in the `X-Reliqra-Api-Key` header
- **Plan:** Reliqra Pro
- **Machine-readable spec:** [`openapi.yaml`](./openapi.yaml) (OpenAPI 3.1)
- **Examples:** [`examples/`](./examples) in curl, Node.js, Python and Swift

## Getting a Key

1. Sign in to [Reliqra Cloud](https://cloud.reliqra.com) with a Reliqra Pro workspace.
2. Open **Settings**, then **Developer API**.
3. Create a key, give it a name and choose its scopes. The full key is shown once, so store it somewhere safe.

Keys begin with `rqk_`, then an environment tag, then 40 hex characters. Test keys use the tag `test`. Revoke a key at any time from the same screen. Revoking works even if the workspace is no longer on Pro.

Keys belong to one workspace. The workspace is always derived from the key, never from the request.

## Authentication

Send the key on every request.

```bash
curl https://api.reliqra.com/v1/inventory \
  -H "X-Reliqra-Api-Key: $RELIQRA_API_KEY"
```

Treat a key like a password: keep it server-side, load it from an environment variable or secret store, and never commit it. The examples in this repository read `RELIQRA_API_KEY` from the environment.

Workspaces that are not on Reliqra Pro receive `403 plan_required` on every route. Re-upgrading restores the same key.

## Scopes

Each key carries only the scopes you grant it. A call that needs a scope the key lacks returns `403 missing_scope`.

| Scope | Allows |
|---|---|
| `inventory:read` | `GET /inventory`, `GET /inventory/{reliqra_id}`, item photos |
| `inventory:write` | `PATCH /inventory/{reliqra_id}` |
| `sales:read` | `GET /sales` |
| `sales:write` | `POST /sales` |
| `shipments:read` | `GET /shipments` |
| `events:read` | `GET /events` |

## Endpoints

| Method and Path | Scope | Purpose |
|---|---|---|
| `GET /inventory` | `inventory:read` | List items. Filters: `status`, `updated_after`. Paginated. |
| `GET /inventory/{reliqra_id}` | `inventory:read` | Get one item. |
| `PATCH /inventory/{reliqra_id}` | `inventory:write` | Update `status`, `sold_price`, `cost`, `value` or `quantity`. |
| `GET /items/{reliqra_id}/image/{front\|back}` | `inventory:read` | Redirects to a short-lived signed photo URL. |
| `GET /sales` | `sales:read` | List sales. Filter: `since`. Paginated. |
| `POST /sales` | `sales:write` | Record a sale, with optional fees. |
| `GET /shipments` | `shipments:read` | List shipments with their items. Paginated. |
| `GET /events` | `events:read` | Poll a change feed. |

Every item has a public `reliqra_id`. Inventory records carry the fields common to all item types plus type-specific fields, so a coin, a card and a gem each read back with the fields that apply to them. Ignore fields you do not use; new ones can be added.

`POST /orders` is reserved and returns `501 not_implemented`. It is not available.

### Updating Items

`PATCH /inventory/{reliqra_id}` takes a JSON object with at least one of `status`, `sold_price`, `cost`, `value`, `quantity`. Any other field is rejected with `422`.

- `status` must be `Active`, `Sold`, `Traded` or `Private`.
- `quantity` must be an integer of 1 or more.
- `sold_price`, `cost` and `value` accept a number of 0 or more, or `null`. An absent key leaves the field unchanged. An explicit `null` clears it to "not known", which is different from `0`.

### Item Photos

`front_photo_url` and `back_photo_url` on an item point at a stable endpoint on this API, or are `null` when there is no photo. Request it with your key and follow the `302` redirect to download the image. The redirect target expires after about ten minutes, so do not store it.

### Recording Sales

```bash
curl -X POST https://api.reliqra.com/v1/sales \
  -H "X-Reliqra-Api-Key: $RELIQRA_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "item_reliqra_id": "<reliqra_id>",
    "sold_at": "2026-01-15T18:30:00Z",
    "sold_price": 42.50,
    "marketplace": "my-site",
    "marketplace_external_id": "order-1001",
    "fees": [{"kind": "processor", "amount": 1.48}]
  }'
```

Returns `201` with the sale. When `marketplace_external_id` is present, repeating the call for the same item and marketplace updates the same sale instead of creating a duplicate.

### Event Feed

`GET /events?after=<id>` returns changes oldest first, each with an increasing integer `id`, a `type` such as `inventory.updated`, `sale.created` or `shipment.updated`, an `occurred_at` time and a `payload`. Save the last `id` you processed and pass it as `after` next time. This suits polling integrations that cannot receive inbound requests.

Events are kept for a limited window. A cursor older than that returns `410 cursor_expired`. Re-read the resource you are syncing and resume from the newest event id.

## Pagination

List endpoints accept `limit` (default 100, maximum 500) and an opaque `cursor`. Responses look like this:

```json
{ "data": [ ], "next_cursor": "opaque-string-or-null" }
```

Pass `next_cursor` back as `cursor` to get the next page. When it is `null` you have the last page. Treat cursors as opaque and do not construct them. The events feed paginates with `after` instead.

## Idempotency

Writes (`PATCH /inventory/{reliqra_id}` and `POST /sales`) accept an optional `Idempotency-Key` header containing a UUID. Replaying the same key with the same request returns the original result. Reusing a key with a different payload returns `409 idempotency_conflict`.

## Rate Limits

Each key is limited to 120 requests per minute by default. When you exceed the limit you receive `429 rate_limited` with a `Retry-After` header giving the seconds to wait. Repeated failed authentication attempts from one address are also throttled with `429`. Back off and retry.

The API as a whole is also capped at 50 requests per second, with bursts up to 100. Above that cap a request returns `429` with the body `{"message":"Too Many Requests"}` and no `Retry-After` header. Treat it like `rate_limited`: wait a second or two and retry with backoff.

Each client address is also limited to 300 requests per minute at the edge, ahead of every other limit. Above it, requests from that address return `429` with the body `{"message":"Too Many Requests"}` and `Retry-After: 60` for about a minute. A single key at its 120-per-minute limit never reaches this one; it matters only when many keys, or unauthenticated traffic, share one address.

## Errors

Errors use one envelope:

```json
{
  "error": {
    "code": "invalid_key",
    "message": "Missing or malformed X-Reliqra-Api-Key header",
    "detail": null
  }
}
```

`detail` is optional and only present when there is structured information, such as per-field validation reasons.

| Status | `code` | Meaning |
|---|---|---|
| 401 | `invalid_key` | Key missing, malformed or unknown. |
| 401 | `revoked_key` | The key was revoked. |
| 403 | `missing_scope` | The key lacks the scope this route needs. |
| 403 | `plan_required` | The workspace is not on Reliqra Pro. |
| 404 | `not_found` | No such route, or no such item in your workspace. |
| 409 | `idempotency_conflict` | Idempotency-Key reused with a different payload. |
| 410 | `cursor_expired` | Event cursor is older than the retention window. |
| 422 | `validation_error` | A parameter or body field is invalid. See `detail`. |
| 429 | `rate_limited` | Slow down. See `Retry-After`. |
| 500 | `internal_error` | Unexpected failure. Retry with backoff. |
| 502 | `upstream_error` | A backing query failed. Retry with backoff. |
| 503 | `auth_unavailable`, `service_unavailable` | Temporary outage. Retry with backoff. |
| 501 | `not_implemented` | Reserved route. Not available. |

Treat every `5xx` as retryable with exponential backoff.

## Quickstart

List your active inventory, following pagination:

```bash
export RELIQRA_API_KEY="rqk_test_0000000000000000000000000000000000000000"   # use your own key

curl "https://api.reliqra.com/v1/inventory?status=Active&limit=50" \
  -H "X-Reliqra-Api-Key: $RELIQRA_API_KEY"
```

Then pass the returned `next_cursor` as `?cursor=` until it is `null`. Full, runnable loops are in [`examples/`](./examples):

| File | Runtime |
|---|---|
| [`curl.sh`](./examples/curl.sh) | bash, curl, jq |
| [`node.mjs`](./examples/node.mjs) | Node.js 18 or newer, no dependencies |
| [`python.py`](./examples/python.py) | Python 3, standard library only |
| [`swift.swift`](./examples/swift.swift) | Swift with URLSession |

## Support

[Contact Us](https://reliqra.com/book.html). The product overview is at [reliqra.com/developer-api.html](https://reliqra.com/developer-api.html).

## License

The example code in [`examples/`](./examples) is released under the [MIT License](./LICENSE). The Reliqra API itself, the Reliqra name and the Reliqra marks are not covered by that license.

---

<sub>© 2026 Reliqra, LLC. Designed and developed by [DeValcourt, LLC](https://www.devalcourt.com).</sub>
