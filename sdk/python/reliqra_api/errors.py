"""Errors raised by the Reliqra client."""
from __future__ import annotations

from typing import Any, Optional


class ReliqraConfigError(Exception):
    """Raised when no API key is supplied."""


class ReliqraError(Exception):
    """A non-success API response, carrying the API's error code.

    `code` is the stable snake_case code such as `plan_required`,
    `missing_scope` or `rate_limited`.
    """

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        detail: Any = None,
        retry_after: Optional[float] = None,
    ) -> None:
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail
        self.retry_after = retry_after


def error_from_response(status: int, body: Any, retry_after: Optional[float]) -> ReliqraError:
    """Build an error from a body that may or may not use the error envelope."""
    env = body.get("error") if isinstance(body, dict) else None
    env = env if isinstance(env, dict) else {}
    gateway = body.get("message") if isinstance(body, dict) else None
    code = env.get("code")
    if not isinstance(code, str):
        code = "rate_limited" if status == 429 else "unknown_error"
    message = env.get("message")
    if not isinstance(message, str):
        message = gateway if isinstance(gateway, str) else f"HTTP {status}"
    return ReliqraError(status, code, message, env.get("detail"), retry_after)
