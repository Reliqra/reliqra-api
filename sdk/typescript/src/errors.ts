/** Raised for any non-success API response, carrying the API's error code. */
export class ReliqraError extends Error {
  readonly status: number;
  /** Stable snake_case code such as `plan_required`, `missing_scope`, `rate_limited`. */
  readonly code: string;
  readonly detail: unknown;
  /** Seconds from the Retry-After header, when present. */
  readonly retryAfter: number | undefined;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    detail?: unknown;
    retryAfter?: number;
  }) {
    super(`${init.status} ${init.code}: ${init.message}`);
    this.name = "ReliqraError";
    this.status = init.status;
    this.code = init.code;
    this.detail = init.detail;
    this.retryAfter = init.retryAfter;
  }
}

/** Raised when no API key is supplied. */
export class ReliqraConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReliqraConfigError";
  }
}

/** Build a ReliqraError from a response body that may or may not use the error envelope. */
export function errorFromResponse(
  status: number,
  body: unknown,
  retryAfter: number | undefined,
): ReliqraError {
  const env = (body as { error?: { code?: unknown; message?: unknown; detail?: unknown } } | null)
    ?.error;
  const gatewayMessage = (body as { message?: unknown } | null)?.message;
  const code =
    typeof env?.code === "string"
      ? env.code
      : status === 429
        ? "rate_limited"
        : "unknown_error";
  const message =
    typeof env?.message === "string"
      ? env.message
      : typeof gatewayMessage === "string"
        ? gatewayMessage
        : `HTTP ${status}`;
  return new ReliqraError({ status, code, message, detail: env?.detail, retryAfter });
}
