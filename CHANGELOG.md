# Changelog

All notable changes to `@hypawave/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.4]

- Bundled skill (`skills/hypawave/SKILL.md`) now points to the MCP server (`@hypawave/mcp`) as the preferred execution path for the accountless flows when the agent's environment supports MCP.

## [0.4.3]

### Changed
- Docs only — no API changes. Corrected wording across `README.md`, `AGENTS.md`,
  and the bundled `skills/hypawave/SKILL.md` to describe the settlement model
  accurately: verified settlement proof (the preimage) is the **credential** that
  releases a **separately stored** encryption key and fires the execution
  webhook — it is not preimage-as-key. Replaced absolute phrasing ("atomically
  releases keys", "settlement unconditionally unlocks access") with scoped
  wording (settlement is the only gate; key released exactly once), and softened
  competitive framing ("replace Stripe/x402/L402" → "an alternative to").
- Repositioned the SDK tagline and npm description from "AI Agent Payments" to
  "AI agent commerce" — now "Bitcoin Lightning SDK for AI agent commerce —
  non-custodial settlement that unlocks files, APIs, and compute" — in
  `README.md` and `package.json`.

## [0.4.2]

### Changed
- Docs only — no API changes. Added the **paid-execution pattern** ("Sell Paid
  APIs & Compute") to `README.md`, `AGENTS.md`, and the bundled
  `skills/hypawave/SKILL.md`: setting `execution_webhook` delivers the payment
  preimage to the seller on settlement, and the buyer holds the same preimage —
  payment itself establishes the buyer's credential for the seller's own API,
  compute, or service. Links the "Sell API Calls & Compute" docs section,
  Recipe 6 in `llms.txt`, and the live Hypawave Compute demo
  (hypawave.com/offers) as the worked example.

## [0.4.1]

### Changed
- Docs only — no API changes. Clarified payer-wallet requirements in `README.md`,
  `AGENTS.md`, and the bundled `skills/hypawave/SKILL.md`: the wallet needs
  **funded outbound liquidity ≥ amount + fees** (a fresh/empty node or Phoenix
  "fee-credit" balance can't pay even when total balance ≥ price), and for small
  or test payments a **custodial wallet over NWC (e.g. Coinos)** avoids channel
  setup entirely — only funding is needed. Mirrors the buyer-wallet guidance in
  `llms.txt`.

## [0.4.0]

### Added
- `StoreFileParams.ciphertext_sha256` (**required**) — the lowercase-hex SHA-256
  of the exact ciphertext you upload. Hypawave verifies it against the stored
  bytes and seals them at the first bolt11 mint, and returns it at key retrieval
  so buyers can verify downloaded bytes before decrypting (content integrity /
  anti-bait-and-switch).

### Changed
- `storeFile()` now requires `ciphertext_sha256`. Compute `sha256` over the same
  bytes you PUT to the presigned upload URL and pass it through. Calls without it
  are rejected by the API with `400 validation_error`.

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
