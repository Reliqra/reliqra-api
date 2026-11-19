import json
import os
import unittest
from unittest import mock

from reliqra_api import ReliqraClient, ReliqraConfigError, ReliqraError

KEY = "rqk_test_0000000000000000000000000000000000000000"


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, method, url, headers, body, follow_redirects):
        self.calls.append(dict(method=method, url=url, headers=headers, body=body, follow=follow_redirects))
        return self.responses.pop(0)


def ok(body, status=200, headers=None):
    return status, {k.lower(): v for k, v in (headers or {}).items()}, json.dumps(body).encode()


def client(responses, **kw):
    t = FakeTransport(responses)
    waits = []
    c = ReliqraClient(api_key=KEY, transport=t, sleep=waits.append, **kw)
    return c, t, waits


class ClientTests(unittest.TestCase):
    def test_requires_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ReliqraConfigError):
                ReliqraClient()

    def test_key_from_env(self):
        with mock.patch.dict(os.environ, {"RELIQRA_API_KEY": KEY}):
            t = FakeTransport([ok({"data": [], "next_cursor": None})])
            ReliqraClient(transport=t).list_inventory()
            self.assertEqual(t.calls[0]["headers"]["X-Reliqra-Api-Key"], KEY)

    def test_list_inventory_query(self):
        c, t, _ = client([ok({"data": [], "next_cursor": None})])
        c.list_inventory(status="Active", limit=50)
        self.assertIn("status=Active", t.calls[0]["url"])
        self.assertIn("limit=50", t.calls[0]["url"])
        self.assertTrue(t.calls[0]["url"].startswith("https://api.reliqra.com/v1/inventory?"))

    def test_iterate_inventory_follows_cursor(self):
        c, t, _ = client([
            ok({"data": [{"reliqra_id": "a"}, {"reliqra_id": "b"}], "next_cursor": "c1"}),
            ok({"data": [{"reliqra_id": "c"}], "next_cursor": None}),
        ])
        ids = [i["reliqra_id"] for i in c.iterate_inventory()]
        self.assertEqual(ids, ["a", "b", "c"])
        self.assertIn("cursor=c1", t.calls[1]["url"])

    def test_iterate_events_uses_after(self):
        c, t, _ = client([
            ok({"data": [{"id": 1}, {"id": 2}], "next_cursor": "2"}),
            ok({"data": [{"id": 3}], "next_cursor": None}),
        ])
        self.assertEqual([e["id"] for e in c.iterate_events()], [1, 2, 3])
        self.assertIn("after=2", t.calls[1]["url"])

    def test_update_sends_null_and_idempotency_key(self):
        c, t, _ = client([ok({"reliqra_id": "a"})])
        c.update_inventory_item("a", {"status": "Sold", "cost": None})
        call = t.calls[0]
        self.assertEqual(call["method"], "PATCH")
        self.assertEqual(json.loads(call["body"]), {"status": "Sold", "cost": None})
        self.assertEqual(len(call["headers"]["Idempotency-Key"]), 36)

    def test_create_sale(self):
        c, t, _ = client([ok({"id": "s1"}, 201)])
        sale = c.create_sale({"item_reliqra_id": "a"}, idempotency_key="11111111-1111-4111-8111-111111111111")
        self.assertEqual(sale["id"], "s1")
        self.assertEqual(t.calls[0]["method"], "POST")
        self.assertEqual(t.calls[0]["headers"]["Idempotency-Key"], "11111111-1111-4111-8111-111111111111")

    def test_image_url_is_redirect_location(self):
        c, t, _ = client([(302, {"location": "https://example.invalid/signed"}, b"")])
        self.assertEqual(c.get_item_image_url("a", "front"), "https://example.invalid/signed")
        self.assertFalse(t.calls[0]["follow"])
        self.assertIn("/items/a/image/front", t.calls[0]["url"])

    def test_error_carries_code(self):
        c, _, _ = client([ok({"error": {"code": "missing_scope", "message": "no", "detail": None}}, 403)])
        with self.assertRaises(ReliqraError) as cm:
            c.list_sales()
        self.assertEqual(cm.exception.code, "missing_scope")
        self.assertEqual(cm.exception.status, 403)

    def test_429_honors_retry_after(self):
        c, t, waits = client([
            ok({"error": {"code": "rate_limited", "message": "slow"}}, 429, {"Retry-After": "7"}),
            ok({"data": [], "next_cursor": None}),
        ])
        c.list_inventory()
        self.assertEqual(waits, [7.0])
        self.assertEqual(len(t.calls), 2)

    def test_429_backoff_and_gateway_body(self):
        gw = ok({"message": "Too Many Requests"}, 429)
        c, t, waits = client([gw, gw, gw], max_retries=2)
        with self.assertRaises(ReliqraError) as cm:
            c.list_inventory()
        self.assertEqual(cm.exception.code, "rate_limited")
        self.assertEqual(waits, [0.5, 1.0])
        self.assertEqual(len(t.calls), 3)

    def test_5xx_retries_for_get(self):
        c, t, _ = client([
            ok({"error": {"code": "upstream_error", "message": "x"}}, 502),
            ok({"data": [], "next_cursor": None}),
        ])
        c.list_inventory()
        self.assertEqual(len(t.calls), 2)

    def test_404_does_not_retry(self):
        c, t, _ = client([ok({"error": {"code": "not_found", "message": "no"}}, 404)])
        with self.assertRaises(ReliqraError):
            c.get_inventory_item("zzz")
        self.assertEqual(len(t.calls), 1)


if __name__ == "__main__":
    unittest.main()
