# Changelog

All notable changes to `@hypawave/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0]

### Added
- Automatic request retries with full-jitter exponential backoff, honoring the
  `Retry-After` header on 429 / overload responses.
- `maxRetries` config option (default `3`; set `0` to disable retries).
- Adaptive backoff in `waitForSettlement` (ramps from `pollInterval` up to
  `maxPollInterval`, default 2s → 20s) instead of a fixed-interval poll.

### Changed
- Retry policy is gated by safety: every `GET` and the server-idempotent POSTs
  (`confirmPayment`, `topup`, `getUnlockStatus`, `getOfferDownloadUrl`) retry on
  5xx and network errors; non-idempotent POSTs (e.g. `createInvoice`) retry only
  on 429. This prevents duplicate side effects on retry.
- `timeout` now applies per attempt rather than to the whole call.
- Query parameters accept `string | number | boolean | undefined`; values are
  serialized centrally and `undefined` is omitted.

### Fixed
- Non-JSON responses (e.g. an HTML 502 from an overloaded proxy) now surface as
  a clean `HypawaveAPIError` instead of throwing an opaque JSON parse error.
- A successful (2xx) response with a non-JSON body now throws instead of
  returning a malformed success object.
