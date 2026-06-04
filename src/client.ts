import type {
  HypawaveConfig,
  CreateInvoiceParams,
  CreateInvoiceResponse,
  BalanceResponse,
  TopupParams,
  TopupResponse,
  UnlockStatusResponse,
  GetKeyResponse,
  UploadUrlParams,
  UploadUrlResponse,
  StoreFileParams,
  StoreFileResponse,
  StoreFileKeyParams,
  ListInvoicesParams,
  ListInvoicesResponse,
  GetBolt11Response,
  ConfirmPaymentParams,
  ConfirmPaymentResponse,
  ReceiptResponse,
  PublicSettingsResponse,
  InvoiceFilesResponse,
  DownloadUrlResponse,
  PaymentPayload,
  OfferDownloadUrlParams,
  PayAndConfirmParams,
  PayAndConfirmResult,
} from "./types";
import { HypawaveAPIError } from "./errors";

const DEFAULT_BASE_URL = "https://hypawave.com";
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 8_000;

type QueryValue = string | number | boolean | undefined;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Full-jitter exponential backoff, honoring a Retry-After header when present. */
function backoffDelay(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  const exp = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
  return Math.random() * exp;
}

async function sha256hex(hex: string): Promise<string> {
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class Hypawave {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(config: HypawaveConfig) {
    if (!config.apiKey) {
      throw new Error("apiKey is required");
    }
    if (!/^sk_(test|live)_.+/.test(config.apiKey)) {
      throw new Error('apiKey must start with "sk_test_" or "sk_live_"');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = Math.max(0, config.maxRetries ?? DEFAULT_MAX_RETRIES);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    query?: Record<string, QueryValue>,
    opts?: { retrySafe?: boolean }
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    // A call is "retry-safe" when repeating it cannot cause duplicate side
    // effects — every GET, plus POSTs the server makes idempotent (e.g. a
    // unique payment_hash). 5xx and network errors are retried only when
    // retry-safe. 429 is always retried regardless: the server explicitly
    // asked the client to slow down and did not process the request, so
    // repeating it (after Retry-After) is safe.
    const retrySafe = opts?.retrySafe ?? method === "GET";

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        // Parse defensively: overloaded backends / proxies often return HTML
        // or empty bodies on 5xx, which would otherwise throw a SyntaxError.
        let data: unknown;
        let parseFailed = false;
        try {
          data = await res.json();
        } catch {
          parseFailed = true;
          data = res.ok
            ? { error: "invalid_response", message: "Server returned a successful status with a non-JSON body." }
            : { error: `http_${res.status}`, message: `Server returned status ${res.status} with a non-JSON body.` };
        }

        if (!res.ok) {
          const retryable = res.status === 429 || (res.status >= 500 && retrySafe);
          if (retryable && attempt < this.maxRetries) {
            clearTimeout(timer);
            await sleep(backoffDelay(attempt, res.headers.get("retry-after")));
            continue;
          }
          throw new HypawaveAPIError(res.status, data as { error: string; message?: string; field?: string });
        }

        // Successful status but unparseable body: surface as an error rather
        // than returning a fake-success object cast to T.
        if (parseFailed) {
          throw new HypawaveAPIError(res.status, data as { error: string; message?: string; field?: string });
        }

        return data as T;
      } catch (err) {
        if (err instanceof HypawaveAPIError) throw err;
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new HypawaveAPIError(408, {
            error: "timeout",
            message: `Request timed out after ${this.timeout}ms`,
          });
        }
        // Network-level failure (DNS, connection reset, etc.). A reset can
        // arrive *after* the server already processed the request, so retry
        // only when the call is retry-safe — otherwise a POST like
        // createInvoice could be duplicated.
        if (retrySafe && attempt < this.maxRetries) {
          clearTimeout(timer);
          await sleep(backoffDelay(attempt, null));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  async createInvoice(params: CreateInvoiceParams): Promise<CreateInvoiceResponse> {
    return this.request<CreateInvoiceResponse>("POST", "/api/agent/create-invoice", params);
  }

  async getBolt11(accessToken: string): Promise<GetBolt11Response> {
    return this.request<GetBolt11Response>("GET", "/api/paystream-cb", undefined, { token: accessToken });
  }

  async confirmPayment(invoiceId: number, params: ConfirmPaymentParams): Promise<ConfirmPaymentResponse> {
    // Server is idempotent on payment_hash (unique index + optimistic lock),
    // so retrying a 5xx cannot double-settle.
    return this.request<ConfirmPaymentResponse>("POST", `/api/invoice/${invoiceId}/confirm`, params, undefined, {
      retrySafe: true,
    });
  }

  getPaymentPayload(params: CreateInvoiceParams, response: CreateInvoiceResponse): PaymentPayload {
    return {
      protocol: "hypawave/v1",
      invoice_id: response.invoice_id,
      amount: response.amount,
      currency: response.currency,
      sats: response.sats,
      btc_usd_rate: response.btc_usd_rate,
      description: params.description ?? null,
      expires_at: response.expires_at,
      bolt11_url: `${this.baseUrl}/api/paystream-cb?token=${response.access_token}`,
      confirm_url: `${this.baseUrl}/api/invoice/${response.invoice_id}/confirm`,
      payment_url: response.payment_url,
      spec_url: `${this.baseUrl}/.well-known/openapi.json`,
      instructions_url: `${this.baseUrl}/llms.txt`,
    };
  }

  async getBalance(currency?: string): Promise<BalanceResponse> {
    const query = currency ? { currency } : undefined;
    return this.request<BalanceResponse>("GET", "/api/agent/balance", undefined, query);
  }

  /**
   * Request a fee-settlement top-up invoice. The server mints a bolt11 for
   * exactly the amount owed — balance can never exceed 0. No arguments are
   * needed; any amount fields in a passed params object are ignored.
   *
   * Throws API errors:
   *   - topup_not_needed   — balance is already ≥ 0
   *   - duplicate_topup    — a pending top-up invoice already exists
   */
  async topup(_params?: TopupParams): Promise<TopupResponse> {
    // Idempotent: server reuses any pending top-up (duplicate_topup / reused).
    return this.request<TopupResponse>("POST", "/api/agent/topup", {}, undefined, { retrySafe: true });
  }

  async getUnlockStatus(invoiceIds: number[]): Promise<UnlockStatusResponse> {
    // Read-only POST: safe to retry on 5xx/network so waitForSettlement can
    // ride through backend overload instead of failing fast.
    return this.request<UnlockStatusResponse>(
      "POST",
      "/api/get-unlock-status",
      { invoice_ids: invoiceIds },
      undefined,
      { retrySafe: true }
    );
  }

  async getKey(invoiceFileId: string, token?: string): Promise<GetKeyResponse> {
    const query: Record<string, string> = { invoice_file_id: invoiceFileId };
    if (token) query.token = token;
    return this.request<GetKeyResponse>("GET", "/api/get-key", undefined, query);
  }

  async getUploadUrl(params: UploadUrlParams): Promise<UploadUrlResponse> {
    return this.request<UploadUrlResponse>("POST", "/api/agent/upload-url", params);
  }

  async storeFile(params: StoreFileParams): Promise<StoreFileResponse> {
    return this.request<StoreFileResponse>("POST", "/api/agent/store-file", params);
  }

  async storeFileKey(params: StoreFileKeyParams): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("POST", "/api/agent/store-file-key", params);
  }

  async listInvoices(params?: ListInvoicesParams): Promise<ListInvoicesResponse> {
    return this.request<ListInvoicesResponse>("GET", "/api/agent/list-invoices", undefined, {
      limit: params?.limit,
      offset: params?.offset,
      status: params?.status,
    });
  }

  async getInvoiceFiles(invoiceIds: number[], token?: string): Promise<InvoiceFilesResponse> {
    const body: Record<string, unknown> = { invoice_ids: invoiceIds };
    if (token) body.token = token;
    return this.request<InvoiceFilesResponse>("POST", "/api/get-invoice-files", body);
  }

  async getDownloadUrl(invoiceFileId: string, token?: string): Promise<DownloadUrlResponse> {
    const body: Record<string, string> = { invoice_file_id: invoiceFileId };
    if (token) body.token = token;
    return this.request<DownloadUrlResponse>("POST", "/api/generate-download-url", body);
  }

  async getOfferDownloadUrl(paymentIntentId: string, params: OfferDownloadUrlParams): Promise<DownloadUrlResponse> {
    return this.request<DownloadUrlResponse>(
      "POST",
      `/api/offers/payment-intent/${paymentIntentId}/download-url`,
      params,
      undefined,
      { retrySafe: true }
    );
  }

  async getReceipt(invoiceId: number): Promise<ReceiptResponse> {
    return this.request<ReceiptResponse>("GET", "/api/agent/receipt", undefined, {
      invoice_id: invoiceId,
    });
  }

  async getPayerReceipt(invoiceId: number, preimage: string): Promise<ReceiptResponse> {
    return this.request<ReceiptResponse>("GET", `/api/invoice/${invoiceId}/receipt`, undefined, {
      preimage,
    });
  }

  async getSettings(): Promise<PublicSettingsResponse> {
    return this.request<PublicSettingsResponse>("GET", "/api/public-settings");
  }

  async waitForSettlement(
    invoiceId: number,
    options?: { pollInterval?: number; maxPollInterval?: number; timeout?: number }
  ): Promise<UnlockStatusResponse["statuses"][string]> {
    // Adaptive polling: start fast, then ramp up so a busy backend isn't
    // pounded on a fixed cadence. Jitter spreads many concurrent clients out.
    const base = options?.pollInterval ?? 2000;
    const maxInterval = options?.maxPollInterval ?? 20_000;
    const timeout = options?.timeout ?? 300_000;
    const start = Date.now();

    for (let attempt = 0; Date.now() - start < timeout; attempt++) {
      const status = await this.getUnlockStatus([invoiceId]);
      const entry = status.statuses?.[String(invoiceId)];

      if (entry?.unlocked) {
        return entry;
      }

      if (entry?.status === "failed" || entry?.status === "expired") {
        return entry;
      }

      const ceiling = Math.min(maxInterval, base * 2 ** attempt);
      const wait = ceiling / 2 + Math.random() * (ceiling / 2);
      await sleep(Math.min(wait, Math.max(0, start + timeout - Date.now())));
    }

    throw new HypawaveAPIError(408, {
      error: "settlement_timeout",
      message: `Settlement not confirmed within ${timeout}ms`,
    });
  }

  async payAndConfirm(params: PayAndConfirmParams): Promise<PayAndConfirmResult> {
    const capability = params.wallet.capabilities?.returnsPreimage;

    if (capability === false || capability === undefined) {
      throw new HypawaveAPIError(400, {
        error: "wallet_no_preimage_support",
        message: "This wallet does not support returning the preimage. Hypawave requires the preimage for settlement confirmation. Use a supported adapter (NWC, LND, CLN, Alby, LNbits) from @hypawave/lightning-adapters.",
      });
    }

    if (capability === "conditional" && !params.allowConditionalPreimage) {
      throw new HypawaveAPIError(400, {
        error: "wallet_conditional_preimage",
        message: "This wallet conditionally supports preimage return (depends on the backing node). Set allowConditionalPreimage: true to proceed at your own risk. If the preimage is not returned after payment, files will not unlock.",
      });
    }

    const { pr: bolt11, terms_hash } = await this.getBolt11(params.accessToken);

    const payResult = await params.wallet.payInvoice(bolt11);

    if (!payResult.preimage || !/^[0-9a-f]{64}$/i.test(payResult.preimage)) {
      throw new HypawaveAPIError(400, {
        error: "wallet_did_not_return_preimage",
        message: "Wallet did not return a valid preimage. Hypawave requires a 64-char hex preimage for settlement confirmation.",
      });
    }

    const computedHash = await sha256hex(payResult.preimage);
    if (payResult.payment_hash && computedHash.toLowerCase() !== payResult.payment_hash.toLowerCase()) {
      throw new HypawaveAPIError(400, {
        error: "preimage_hash_mismatch",
        message: `Client-side verification failed: SHA256(preimage) does not match payment_hash. Expected ${payResult.payment_hash}, got ${computedHash}.`,
      });
    }

    const paymentHash = payResult.payment_hash || computedHash;

    const confirmation = await this.confirmPayment(params.invoiceId, {
      payment_hash: paymentHash,
      preimage: payResult.preimage,
      terms_hash,
    });

    return {
      payment_hash: paymentHash,
      preimage: payResult.preimage,
      terms_hash,
      fees_paid_msat: payResult.fees_paid_msat,
      confirmation,
    };
  }
}
