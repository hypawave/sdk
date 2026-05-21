# @hypawave/sdk

**Lightning SDK for AI Agent Payments — non-custodial Bitcoin settlement with preimage proof**

[![npm version](https://img.shields.io/npm/v/@hypawave/sdk.svg)](https://www.npmjs.com/package/@hypawave/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/hypawave/sdk/blob/main/LICENSE)
[![Node >= 18](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

*Status: Alpha. API is usable; breaking changes possible before 1.0.*

> ⚠️ **Hypawave has no token and will never issue one.** Any "HYPA," "WAVE," airdrop, or token offer claiming to be from Hypawave is a scam. Hypawave is non-custodial Bitcoin Lightning settlement — buyers pay creators directly in sats. The protocol fee is the only economic primitive.

TypeScript SDK for settlement-triggered Lightning execution. Fetch creator-direct Lightning invoices, confirm preimage proof, and trigger deterministic unlocks.

**Payment is the authorization — confirmed settlement unconditionally unlocks access.**

## Why Hypawave

AI agents need to pay and get access without accounts, custody, or manual delivery. Hypawave turns Lightning settlement proof into deterministic execution — the same preimage that proves payment also unlocks the file, the API call, or the webhook.

This SDK covers **Path 2**: account-based agent flows. Accountless Paths 3a and 3b use raw HTTP via [llms.txt](https://hypawave.com/llms.txt) and the [OpenAPI spec](https://hypawave.com/.well-known/openapi.json). Requires programmable Lightning infrastructure (LND, CLN, Alby API, LNbits, NWC, etc.) that returns the preimage after payment.

## Features

- **Non-custodial** — buyers pay creators directly; Hypawave never holds principal funds
- **Cryptographic settlement proof** — SHA256(preimage) == payment_hash verification
- **40+ fiat currencies** with live BTC conversion
- **End-to-end encrypted file delivery** — payment-gated AES-256-GCM decryption keys
- **Agent-to-agent interop** — self-describing payment payloads, zero-friction for payer agents
- **Pre-authorization** — terms_hash snapshot prevents price manipulation between fetch and pay
- **Settlement-triggered execution webhooks** — fire server-side actions on payment confirmation
- **Programmable invoice expiry** — 1h, 24h, 7d, or never

## Requirements

This SDK requires **programmable Lightning infrastructure** that exposes the preimage after payment:

- LND, CLN, Alby API, LNbits, NWC, or equivalent

**Consumer wallets (Wallet of Satoshi, Phoenix, etc.) do not reliably expose the preimage and are not suitable for agent integrations.** Files and data will not unlock without a preimage.

## Install

```bash
npm install @hypawave/sdk
```

## Quick Start

```typescript
import { Hypawave } from "@hypawave/sdk";

const pp = new Hypawave({ apiKey: "sk_live_..." });

// Create a payment request for a payer agent
const invoice = await pp.createInvoice({
  client_email: "alice@example.com",
  client_first_name: "Alice",
  client_last_name: "Smith",
  amount: 5.00,
  due_date: "2026-12-31",
  payment_destination: "creator@getalby.com",
});

console.log(invoice.invoice_id);   // Use for confirmation + key retrieval
console.log(invoice.sats);        // Amount in satoshis

// Fetch the creator-direct Lightning invoice + terms hash
const { pr: bolt11, terms_hash } = await pp.getBolt11(invoice.access_token);

// Pay with programmable Lightning infrastructure that returns a preimage
const payResult = await yourLightningNode.pay(bolt11);

// Submit preimage proof to trigger settlement and deterministic unlock
await pp.confirmPayment(invoice.invoice_id, {
  payment_hash: payResult.payment_hash,
  preimage: payResult.preimage,
  terms_hash,
});

// Retrieve files and decryption keys
const fileData = await pp.getInvoiceFiles([invoice.invoice_id]);
const files = fileData.files[invoice.invoice_id] || [];

for (const file of files) {
  const { downloadUrl } = await pp.getDownloadUrl(file.id);
  const key = await pp.getKey(file.id);
  // downloadUrl = signed URL to fetch the encrypted file
  // key.encryption_key = AES-256-GCM key (base64)
  // key.iv_hex = initialization vector (hex)
}
```

## Settlement Flow

```
createInvoice ──▶ getBolt11 ──▶ pay (your node) ──▶ confirmPayment ──▶ unlock
   (terms)        (bolt11)        (preimage)         (proof)         (files/exec)
```

Three calls to Hypawave, one call to your Lightning node. Preimage from your node closes the loop.

## SDK for ergonomics. Raw HTTP for accountless agents.

The SDK handles types, retries, polling, error parsing, and self-describing payload generation for **Path 2** (account-based agent API). Use raw HTTP when you need:

- **Accountless keypair auth** (Paths 3a and 3b) — secp256k1-signed requests, no API key
- **Zero npm dependencies** — language-agnostic agents, three HTTP calls
- **Direct OpenAPI consumption** — code generation, MCP servers, raw `curl`

Resources for raw HTTP:

- **Agent instructions**: [hypawave.com/llms.txt](https://hypawave.com/llms.txt) — step-by-step settlement flows for LLM-powered agents
- **OpenAPI spec**: [hypawave.com/.well-known/openapi.json](https://hypawave.com/.well-known/openapi.json) — full machine-readable API schema (OpenAPI 3.1)

## API

### `new Hypawave(config)`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `apiKey` | `string` | — | API key (`sk_test_*` or `sk_live_*`) |
| `baseUrl` | `string` | `https://hypawave.com` | API base URL |
| `timeout` | `number` | `30000` | Request timeout in ms |

### `createInvoice(params)`

Create a payment request. Returns a payment URL for the payer.

```typescript
const invoice = await pp.createInvoice({
  client_email: "payer@example.com",
  client_first_name: "Jane",
  client_last_name: "Doe",
  amount: 10.00,
  due_date: "2026-12-31",
  payment_destination: "creator@getalby.com",
  description: "API access for December",
  currency: "USD",        // 40+ currencies supported
  expires_in: "24h",      // "1h", "24h", "7d", or null
  execution_webhook: "https://your-server.com/on-paid", // optional
});
```

### `getBolt11(accessToken)`

Fetch the creator-issued Lightning bolt11 invoice for payment. The `access_token`
is returned by `createInvoice()`.

```typescript
const { pr: bolt11, terms_hash } = await pp.getBolt11(invoice.access_token);
// bolt11 is the Lightning invoice to pay via your node/API
// terms_hash is used for pre-authorization verification at confirm time
```

### `confirmPayment(invoiceId, params)`

Confirm settlement by submitting the Lightning preimage. Call this after paying
the creator-issued bolt11. Your Lightning node or API returns the `payment_hash`
and `preimage` on successful payment — pass them here.

```typescript
const result = await pp.confirmPayment(invoice.invoice_id, {
  payment_hash: paymentResponse.payment_hash,
  preimage: paymentResponse.preimage,
  terms_hash, // optional but recommended — rejects if terms changed
});
// result.ok === true
// result.already_settled === false (or true on retry)
```

### `getPaymentPayload(params, response)`

Build a self-describing payment payload to send to another agent, API, or service.
The receiver can pay using three HTTP calls — no Hypawave SDK, account, or prior
knowledge required.

```typescript
const params = { amount: 5.00, currency: "USD", description: "API access", ... };
const invoice = await pp.createInvoice(params);
const payload = pp.getPaymentPayload(params, invoice);

// Send `payload` to the receiving agent/API
// The receiver follows:
//   1. Read payload.instructions_url for full settlement instructions
//   2. GET payload.bolt11_url → fetch bolt11
//   3. Pay the bolt11 via Lightning node
//   4. POST payload.confirm_url with { payment_hash, preimage }
```

### `getBalance(currency?)`

Check your settlement balance.

```typescript
const balance = await pp.getBalance("USD");
console.log(balance.available_sats);
console.log(balance.has_outstanding_fee); // true = top up needed
```

### `topup()`

Generate a Lightning invoice to clear outstanding fees. Top-ups are strictly
fee-settlement — the server mints a bolt11 for exactly the amount owed, so
you do not pass an amount. If your balance is already at or above zero the
call returns `topup_not_needed` (HTTP 400).

```typescript
const topup = await pp.topup();
console.log(topup.bolt11);      // Pay this invoice
console.log(topup.amount_sats); // Exact owed amount the server quoted
if (topup.reused) {
  // An existing pending top-up was returned instead of a fresh one.
}
```

### `getUnlockStatus(invoiceIds)`

Check settlement status for up to 25 invoices at once.

```typescript
const status = await pp.getUnlockStatus([101, 102, 103]);

for (const [id, info] of Object.entries(status.statuses)) {
  console.log(id, info.unlocked, info.settlement_proof?.preimage);
}
```

### `getInvoiceFiles(invoiceIds, token?)`

Fetch file metadata for up to 25 invoices. Returns file IDs, names, and encrypted
file URLs grouped by invoice ID. Supports agent auth (Bearer) or payer auth
(`token` = access_token from invoice).

```typescript
// Agent auth (creator-side)
const fileData = await pp.getInvoiceFiles([42, 43]);

// Payer auth (access_token from invoice or payment payload)
const fileData = await pp.getInvoiceFiles([42], invoice.access_token);

const files = fileData.files[42] || [];
// files[0].id — file ID (use with getDownloadUrl and getKey)
// files[0].file_name — original file name
```

### `getDownloadUrl(invoiceFileId, token?)`

Generate a signed download URL (5 min) for an encrypted file. The invoice must be
paid. Supports agent auth (Bearer) or payer auth (`token` = access_token).

```typescript
// Agent auth
const { downloadUrl } = await pp.getDownloadUrl(fileId);

// Payer auth
const { downloadUrl } = await pp.getDownloadUrl(fileId, invoice.access_token);
```

### `getKey(invoiceFileId, token?)`

Retrieve the decryption key for a specific file. Requires the invoice to be paid.
Download attempts are tracked — a 72-hour reclaim window applies. Supports agent
auth (Bearer) or payer auth (`token` = access_token).

```typescript
// Agent auth
const key = await pp.getKey(fileId);

// Payer auth
const key = await pp.getKey(fileId, invoice.access_token);
// key.encryption_key — Base64 AES-256-GCM key
// key.iv_hex — Hex IV for decryption
// key.downloads_used — number of downloads so far
// key.max_downloads — maximum allowed
```

### `getOfferDownloadUrl(paymentIntentId, params)`

Generate a signed download URL (5 min) for a single encrypted offer file (Path 3b).
Scoped to a specific `offer_file_id` — must belong to the payment intent's offer.
Authenticated via `claim_token` or `preimage`.

```typescript
const { downloadUrl } = await pp.getOfferDownloadUrl(paymentIntentId, {
  offer_file_id: fileId,
  claim_token: claimToken,
});
// downloadUrl — time-limited signed URL to fetch the encrypted file
```

### `waitForSettlement(invoiceId, options?)`

Poll until an invoice settles, fails, or expires.

```typescript
const result = await pp.waitForSettlement(invoiceId, {
  pollInterval: 2000,  // ms between polls (default: 2000)
  timeout: 300000,     // max wait time in ms (default: 300000)
});

if (result.unlocked) {
  const fileData = await pp.getInvoiceFiles([invoiceId]);
  const files = fileData.files[invoiceId] || [];
  for (const file of files) {
    const { downloadUrl } = await pp.getDownloadUrl(file.id);
    const key = await pp.getKey(file.id);
    // Fetch encrypted file from downloadUrl, decrypt with key
  }
}
```

### `getReceipt(invoiceId)`

Fetch a settled invoice receipt with cryptographic proof.

```typescript
const { receipt } = await pp.getReceipt(invoiceId);
// receipt.payment_hash, receipt.preimage, receipt.receipt_verified
// receipt.amount, receipt.currency, receipt.settled_at
// receipt.creator, receipt.file_count
```

### `getSettings()`

Fetch current platform configuration (fee percentage, amount limits, file limits,
BTC price). Values are admin-configurable and may change.

```typescript
const settings = await pp.getSettings();
// settings.fee_percent, settings.min_invoice_usd, settings.max_invoice_usd
// settings.max_file_size_mb, settings.max_files_per_invoice
// settings.btc_usd_price
```

### Other Methods

Additional methods available — see types for full signatures, or [openapi.json](https://hypawave.com/.well-known/openapi.json) for the complete API reference.

- `listInvoices(params?)` — list invoices with filters and pagination
- `getPayerReceipt(invoiceId, accessToken)` — receipt fetch using a payer access token (no API key needed)
- `getUploadUrl(params)` — signed URL for encrypted file upload (creator side)
- `storeFile(params)` — register an uploaded file against an invoice
- `storeFileKey(params)` — register a file's encryption key against an invoice
- `request(path, options)` — low-level escape hatch for direct API calls

## Error Handling

All API errors throw `HypawaveAPIError` with structured fields:

```typescript
import { Hypawave, HypawaveAPIError } from "@hypawave/sdk";

try {
  await pp.createInvoice({ ... });
} catch (err) {
  if (err instanceof HypawaveAPIError) {
    console.log(err.status);  // HTTP status code
    console.log(err.code);    // Error code (e.g. "validation_error")
    console.log(err.message); // Human-readable message
    console.log(err.field);   // Field name (validation errors)

    if (err.isAuth) { /* re-authenticate */ }
    if (err.isRateLimit) { /* back off */ }
    if (err.isOutstandingFee) { /* 402 outstanding_fee — call pp.topup() */ }
  }
}
```

## Agent-to-Agent Flow

```typescript
// Agent A (creator): Create a payment request and build the payload
const params = {
  client_email: "agentb@system.ai",
  client_first_name: "Agent",
  client_last_name: "B",
  amount: 2.00,
  due_date: "2026-12-31",
  payment_destination: "creator@getalby.com",
  description: "Dataset access: Q4 training data",
};
const invoice = await agentA.createInvoice(params);
const payload = agentA.getPaymentPayload(params, invoice);

// Agent A sends `payload` to Agent B (via HTTP, MCP, A2A, etc.)

// Agent B (payer): three HTTP calls — no SDK, no account needed
const bolt11Res = await fetch(payload.bolt11_url);
const { pr: bolt11 } = await bolt11Res.json();

const payResult = await agentBNode.pay(bolt11); // Lightning node/API

await fetch(payload.confirm_url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    payment_hash: payResult.payment_hash,
    preimage: payResult.preimage,
  }),
});
// Settlement confirmed — files unlocked for retrieval
```

For the complete raw HTTP flow (file retrieval, Path 3a/3b, and more), see [llms.txt](https://hypawave.com/llms.txt).

## Where Hypawave Fits In The Agent Payment Stack

Most tools handle checkout, paid requests, or wallet rails. **Hypawave executes APIs, files, and actions after Bitcoin settlement is verified.**

*This is a layer comparison, not a claim that these tools are interchangeable.*

| Capability | Hypawave | Stripe Machine Payments | x402 | ACP | AP2 | Raw Lightning |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Payment proof triggers release/execution | ✅ | ⚠️ payment + usage rails | ⚠️ per-request paywall | ❌ checkout layer | ❌ authorization layer | ❌ no app layer |
| Customer funds bypass platform custody | ✅ | ❌ Stripe balance | ⚠️ facilitator-dependent | ❌ platform-mediated | ⚠️ rail-dependent | ✅ |
| Bitcoin/Lightning-native | ✅ | ❌ cards + stablecoins | ❌ stablecoin-first | ❌ checkout protocol | ⚠️ rail-dependent | ✅ |
| Cryptographic settlement proof | ✅ | ⚠️ platform records | ⚠️ settlement proof varies | ❌ checkout state | ⚠️ mandate proof | ✅ |
| Accountless agent access | ✅ | ⚠️ platform-dependent | ⚠️ wallet/facilitator | ⚠️ app ecosystem | ⚠️ mandate framework | ⚠️ keys, no app layer |
| Mainstream billing, cards, reporting | ❌ | ✅ | ❌ | ⚠️ merchant checkout | ⚠️ partner ecosystem | ❌ |

Hypawave is the execution layer: the same preimage that proves payment atomically releases encrypted file keys and fires the execution webhook. For basic file/key unlock flows, the delivery layer is built in.

## Links

- **Website**: [hypawave.com](https://hypawave.com)
- **Documentation**: [hypawave.com/docs](https://hypawave.com/docs)
- **Architecture**: [hypawave.com/architecture](https://hypawave.com/architecture)
- **OpenAPI Spec**: [hypawave.com/.well-known/openapi.json](https://hypawave.com/.well-known/openapi.json)
- **Agent Instructions (llms.txt)**: [hypawave.com/llms.txt](https://hypawave.com/llms.txt)

## Support & Contact

- **Issues / bug reports**: [github.com/hypawave/sdk/issues](https://github.com/hypawave/sdk/issues)
- **Security**: report privately to support@hypawave.com (please do not file public issues for vulnerabilities)
- **General inquiries**: support@hypawave.com

### Official Channels Only

Hypawave only operates via these official channels. Anything else is impersonation:

- **Website**: [hypawave.com](https://hypawave.com)
- **GitHub**: [github.com/hypawave/sdk](https://github.com/hypawave/sdk)
- **npm**: [npmjs.com/package/@hypawave/sdk](https://www.npmjs.com/package/@hypawave/sdk)
- **Email**: support@hypawave.com

There is no Hypawave token, airdrop, ICO, or sale. Hypawave does not request wallet connections outside its documented payment flow. Verify any link claiming to be Hypawave against this list before connecting a wallet or signing transactions.

## License

[MIT](./LICENSE)
