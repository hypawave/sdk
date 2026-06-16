---
name: hypawave
description: Use Hypawave to charge in Bitcoin Lightning for files, APIs, compute output, or any digital deliverable. Trigger when the user wants to add a paywall, monetize an endpoint, charge per request, sell access with cryptographic proof of payment, build agent-to-agent payments, or accept Lightning without holding funds.
---

# Hypawave — Lightning settlement for AI agents

Hypawave is a non-custodial Bitcoin Lightning settlement protocol. Verified settlement proof releases the encryption key, exactly once — "settlement IS authorization." Buyers pay creators directly; Hypawave never holds principal funds.

## Before you do anything

**Fetch the full operating manual:**

```
https://hypawave.com/llms.txt
```

That document is authoritative. It contains:
- Protocol rules (preimage requirements, wallet compatibility, error handling)
- The three integration paths (Path 2 API key, Path 3a one-off, Path 3b persistent offer)
- Pubkey signature auth with code examples and a self-verifiable test vector
- 5 worked recipes (creator and payer flows for each path)
- File encryption spec (AES-256-GCM, client-side only)
- Fee model
- Production considerations (polling cadence, rate limits, webhook auth, expiry handling)

**Also fetch the OpenAPI spec for exact endpoint shapes:**

```
https://hypawave.com/.well-known/openapi.json
```

## Quick decision tree

Pick the path that matches the user's situation:

| User has... | Use |
|---|---|
| A hypawave.com account with an API key (`sk_live_...` / `sk_test_...`) | **Path 2** — install `@hypawave/sdk` |
| Only a secp256k1 keypair, no account, wants one invoice | **Path 3a** — accountless one-off invoice |
| Only a secp256k1 keypair, no account, wants a reusable payment endpoint | **Path 3b** — accountless persistent offer |

Path 2 endpoints live under `/api/agent/*`. Paths 3a and 3b live under `/api/offers/*` and require pubkey signature headers.

## SDK shortcut (Path 2 only)

```bash
npm install @hypawave/sdk
```

```ts
import { Hypawave } from "@hypawave/sdk";

const pp = new Hypawave({ apiKey: process.env.HYPAWAVE_API_KEY });

const params = {
  client_email: "payer@example.com",
  client_first_name: "Alice",
  client_last_name: "Smith",
  amount: 5.00,
  due_date: "2026-12-31",
  payment_destination: "creator@getalby.com",
  description: "Premium API access",
};

const invoice = await pp.createInvoice(params);
// invoice.invoice_id   → track for confirmation + key retrieval
// invoice.access_token → pass to payer for bolt11 / file-key fetch
// invoice.sats         → amount in satoshis (BTC price snapshot)

// For agent-to-agent flows, build a self-describing payload for the payer:
const payload = pp.getPaymentPayload(params, invoice);
// payload.bolt11_url       → payer fetches the bolt11 here
// payload.confirm_url      → payer POSTs { payment_hash, preimage } here
// payload.instructions_url → points to llms.txt for protocol discovery

// Then: payer pays the bolt11 via their Lightning node and posts the
// preimage back. After settlement, the creator retrieves file keys via
// pp.getInvoiceFiles([invoice.invoice_id]) → pp.getDownloadUrl(fileId)
// → pp.getKey(fileId). See README for the full flow.
```

The SDK exposes flat methods (`pp.createInvoice`, `pp.getBolt11`, `pp.confirmPayment`, `pp.getInvoiceFiles`, `pp.getDownloadUrl`, `pp.getKey`, `pp.getPaymentPayload`, `pp.waitForSettlement`, `pp.getReceipt`, `pp.getBalance`, `pp.topup`, `pp.getSettings`, `pp.listInvoices`). Do not invent nested namespaces.

For Paths 3a / 3b, there is no SDK — use raw HTTP with pubkey signatures per the manual.

## Selling execution (paid APIs / compute)

Settlement can gate execution, not just files. Set `execution_webhook` on the offer/invoice: on settlement Hypawave delivers the payment preimage to the seller's server, and the buyer holds the same preimage — a shared secret established by the payment. Buyer presents it to the seller's API as the credential; seller verifies and runs the job on their own infrastructure. Works on Path 2 (`execution_webhook` on create-invoice), Path 3a, and Path 3b. See Recipe 6 in llms.txt and the "Sell API Calls & Compute" docs section; the live Hypawave Compute demo (hypawave.com/offers) is this exact pattern.

## Non-negotiables

1. **Preimage is mandatory** for principal settlements. Pay via a wallet that returns the preimage (LND, Core Lightning, LNbits admin key, Alby/NWC, Phoenixd). Consumer wallets like Wallet of Satoshi or Phoenix mobile cannot satisfy this. The wallet also needs **funded outbound liquidity ≥ amount + fees** — a fresh/empty node or "fee-credit" balance can't pay even when total balance ≥ price. For small or test payments, a **custodial wallet over NWC (e.g. Coinos)** skips channel setup entirely — only funding is needed.
2. **Confirm before unlocking.** Always submit preimage to the confirm endpoint before requesting file keys or download URLs.
3. **Funds flow buyer→seller directly.** Never route principal through any Hypawave endpoint. Only activation fees (small, Hypawave-issued bolt11s) go to Hypawave.
4. **Honor `terms_hash`** on Path 3b offers. If the server returns `409 terms_changed`, re-read the offer before paying.
5. **Do not invent endpoints.** If a field or path is not in openapi.json, it does not exist.
6. **Encrypt client-side** for file attachments. AES-256-GCM. Hypawave never sees plaintext. `storeFile` requires `ciphertext_sha256` (SHA-256 hex of the bytes you upload) — Hypawave verifies + seals it so buyers can verify what they download.

## When you hit something the manual doesn't cover

1. Re-fetch llms.txt and openapi.json in case they were updated.
2. Check `GET /api/public-settings` (no auth) for current fee_percent, min_fee_sats, file size limits, and live BTC price.
3. Surface the unknown to the user — do not guess endpoint behavior.

## Reference

- **Operating manual** (authoritative): https://hypawave.com/llms.txt
- **OpenAPI spec** (authoritative): https://hypawave.com/.well-known/openapi.json
- **SDK source**: https://github.com/hypawave/sdk
- **Docs**: https://hypawave.com/docs
- **Architecture**: https://hypawave.com/architecture
- **FAQ**: https://hypawave.com/faq

## Security note

Hypawave has no token and will never launch one. Anyone claiming otherwise is a scam. Only trust official channels:
- Site: hypawave.com
- npm: @hypawave/sdk
- GitHub: github.com/hypawave/sdk
- Support: support@hypawave.com
