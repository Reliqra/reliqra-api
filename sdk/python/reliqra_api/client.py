"""Reliqra API client. Standard library only (urllib)."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, Iterator, Optional, Tuple, Union

from .errors import ReliqraConfigError, error_from_response

DEFAULT_BASE_URL = "https://api.reliqra.com/v1"

# A transport takes (method, url, headers, body_bytes_or_None, follow_redirects)
# and returns (status, headers_dict_lowercased, body_bytes).
Transport = Callable[[str, str, Dict[str, str], Optional[bytes], bool], Tuple[int, Dict[str, str], bytes]]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D401
        return None


def _urllib_transport(method, url, headers, body, follow_redirects):
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    opener = urllib.request.build_opener() if follow_redirects else urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(req, timeout=60) as res:
            return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def _iso(value: Union[str, datetime, None]) -> Optional[str]:
    return value.isoformat() if isinstance(value, datetime) else value


class ReliqraClient:
    """Client for the Reliqra API.

    The key comes from `api_key` or the RELIQRA_API_KEY environment variable.
    Every method returns plain dicts, as decoded from the JSON response.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        max_retries: int = 3,
        transport: Optional[Transport] = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        key = api_key or os.environ.get("RELIQRA_API_KEY")
        if not key:
            raise ReliqraConfigError(
                "No API key. Pass api_key or set the RELIQRA_API_KEY environment variable."
            )
        self._key = key
        self._base = base_url.rstrip("/")
        self._max_retries = max_retries
        self._transport = transport or _urllib_transport
        self._sleep = sleep

    # ---- Inventory ------------------------------------------------------

    def list_inventory(self, *, status=None, updated_after=None, limit=None, cursor=None) -> dict:
        return self._json("GET", "/inventory", query={
            "limit": limit, "cursor": cursor, "status": status, "updated_after": _iso(updated_after),
        })

    def iterate_inventory(self, **params) -> Iterator[dict]:
        """Yield every matching item, following pagination."""
        return self._paginate(self.list_inventory, params)

    def get_inventory_item(self, reliqra_id: str) -> dict:
        return self._json("GET", f"/inventory/{_q(reliqra_id)}")

    def update_inventory_item(self, reliqra_id: str, patch: dict, idempotency_key: Optional[str] = None) -> dict:
        """PATCH an item. An explicit None clears sold_price, cost or value."""
        return self._json(
            "PATCH", f"/inventory/{_q(reliqra_id)}", body=patch,
            idempotency_key=idempotency_key or str(uuid.uuid4()),
        )

    def get_item_image_url(self, reliqra_id: str, side: str) -> str:
        """Return the short-lived signed photo URL (the API answers 302).

        The URL expires after about ten minutes; do not store it.
        """
        if side not in ("front", "back"):
            raise ValueError("side must be 'front' or 'back'")
        status, headers, body = self._send(
            "GET", f"/items/{_q(reliqra_id)}/image/{side}", follow_redirects=False
        )
        location = headers.get("location")
        if not location:
            raise error_from_response(status, None, None)
        return location

    # ---- Sales ----------------------------------------------------------

    def list_sales(self, *, since=None, limit=None, cursor=None) -> dict:
        return self._json("GET", "/sales", query={"limit": limit, "cursor": cursor, "since": _iso(since)})

    def iterate_sales(self, **params) -> Iterator[dict]:
        return self._paginate(self.list_sales, params)

    def create_sale(self, sale: dict, idempotency_key: Optional[str] = None) -> dict:
        return self._json("POST", "/sales", body=sale, idempotency_key=idempotency_key or str(uuid.uuid4()))

    # ---- Shipments ------------------------------------------------------

    def list_shipments(self, *, limit=None, cursor=None) -> dict:
        return self._json("GET", "/shipments", query={"limit": limit, "cursor": cursor})

    def iterate_shipments(self, **params) -> Iterator[dict]:
        return self._paginate(self.list_shipments, params)

    # ---- Events ---------------------------------------------------------

    def list_events(self, *, after=None, limit=None) -> dict:
        return self._json("GET", "/events", query={"limit": limit, "after": after})

    def iterate_events(self, after: int = 0, limit: Optional[int] = None) -> Iterator[dict]:
        """Yield events oldest first until caught up. Pages with `after`."""
        while True:
            page = self.list_events(after=after, limit=limit)
            for event in page["data"]:
                yield event
            nxt = page.get("next_cursor")
            if not nxt:
                return
            try:
                nxt_int = int(nxt)
            except (TypeError, ValueError):
                return
            if nxt_int <= after:
                return
            after = nxt_int

    # ---- Internals ------------------------------------------------------

    @staticmethod
    def _paginate(fetch: Callable[..., dict], params: dict) -> Iterator[dict]:
        params = dict(params)
        while True:
            page = fetch(**params)
            for item in page["data"]:
                yield item
            cursor = page.get("next_cursor")
            if not cursor:
                return
            params["cursor"] = cursor

    def _json(self, method, path, query=None, body=None, idempotency_key=None) -> Any:
        _, _, raw = self._send(method, path, query=query, body=body, idempotency_key=idempotency_key)
        return json.loads(raw.decode("utf-8")) if raw else None

    def _send(self, method, path, query=None, body=None, idempotency_key=None, follow_redirects=True):
        url = self._base + path
        qs = urllib.parse.urlencode({k: v for k, v in (query or {}).items() if v is not None and v != ""})
        if qs:
            url += "?" + qs
        headers = {"X-Reliqra-Api-Key": self._key, "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        # 5xx retries are only safe for reads and for writes that carry an idempotency key.
        retry_5xx = method == "GET" or idempotency_key is not None

        attempt = 0
        while True:
            status, resp_headers, raw = self._transport(method, url, headers, data, follow_redirects)
            if 200 <= status < 300 or (not follow_redirects and 300 <= status < 400):
                return status, resp_headers, raw
            ra = resp_headers.get("retry-after", "").strip()
            try:
                retry_after: Optional[float] = float(ra) if ra else None
            except ValueError:
                retry_after = None
            retryable = status == 429 or (status >= 500 and retry_5xx)
            if retryable and attempt < self._max_retries:
                self._sleep(retry_after if retry_after is not None else min(0.5 * 2 ** attempt, 30.0))
                attempt += 1
                continue
            try:
                parsed = json.loads(raw.decode("utf-8")) if raw else None
            except ValueError:
                parsed = None
            raise error_from_response(status, parsed, retry_after)


def _q(segment: str) -> str:
    return urllib.parse.quote(segment, safe="")
