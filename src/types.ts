export interface HypawaveConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  /** Max automatic retries on 429 / retryable 5xx / network errors. Default 3. Set 0 to disable. */
  maxRetries?: number;
}

export interface CreateInvoiceParams {
  client_email: string;
  client_first_name: string;
  client_last_name: string;
  amount: number;
  due_date: string;
  company_name?: string;
  description?: string;
  currency?: string;
  expires_in?: "1h" | "24h" | "7d" | null;
  expires_at?: string | null;
  creator_first_name?: string;
  creator_last_name?: string;
  creator_company_name?: string;
  creator_fingerprint?: string;
  /**
   * Optional override for the Lightning payment destination (Lightning Address
   * or LNURL-pay URL). Defaults to the API key owner's stored `lightning_address`.
   * Override supports marketplace routing (per-invoice seller), multi-wallet
   * owners, and pass-through flows where the agent facilitates for a third
   * party. Funds always flow wallet-to-wallet — Hypawave remains non-custodial.
   */
  payment_destination?: string;
  execution_webhook?: string;
}

export interface CreateInvoiceResponse {
  ok: true;
  invoice_id: number;
  access_token: string;
  payment_url: string;
  stream_id: string;
  amount: number;
  currency: string;
  sats: number;
  btc_usd_rate: number;
  expires_at: string | null;
}

export interface BalanceResponse {
  available_sats: number;
  fiat_equivalent: number;
  currency: string;
  btc_price: number;
  has_outstanding_fee: boolean;
}

/**
 * Top-ups are fee-settlement only. The server always mints a bolt11 for
 * exactly the amount owed — callers cannot specify an amount. This interface
 * is kept as an empty object for call-site stability.
 */
export type TopupParams = Record<string, never>;

export interface TopupResponse {
  ok: true;
  bolt11: string;
  payment_hash: string;
  /** Exact owed amount the server quoted. */
  amount_sats: number;
  expires_at: string | null;
  /** True if an existing pending top-up was returned instead of a fresh one. */
  reused?: boolean;
}

export interface UnlockStatusResponse {
  unlocked: Record<string, boolean>;
  statuses: Record<
    string,
    {
      unlocked: boolean;
      status: string;
      failure_reason: string | null;
      settlement_proof: {
        payment_hash: string | null;
        preimage: string | null;
        settled_at: string | null;
      } | null;
    }
  >;
}

export interface GetKeyResponse {
  encryption_key: string;
  iv_hex: string;
  downloads_used: number;
  max_downloads: number;
  reclaim_window_hours: number;
}

export interface ApiKeyInfo {
  id: string;
  key_prefix: string;
  mode: "test" | "live";
  label: string | null;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface UploadUrlParams {
  fileName: string;
  contentType: string;
  fileSize?: number;
}

export interface UploadUrlResponse {
  signedUrl: string;
  objectKey: string;
}

export interface StoreFileParams {
  invoice_id: number;
  file_name: string;
  encrypted_file_url: string;
  iv_hex: string;
  key_hash?: string;
  size?: number;
}

export interface StoreFileResponse {
  ok: true;
  id: string;
}

export interface StoreFileKeyParams {
  invoice_file_id: string;
  key_b64: string;
}

export interface ListInvoicesParams {
  limit?: number;
  offset?: number;
  status?: "paid" | "not_paid" | "expired";
}

export interface InvoiceItem {
  invoice_id: number;
  stream_id: string | null;
  amount: number;
  currency: string;
  description: string | null;
  status: "paid" | "pending" | "expired";
  payment_destination: string | null;
  access_token: string | null;
  payment_url: string | null;
  client_email: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  created_at: string;
  due_date: string;
  expires_at: string | null;
  has_file: boolean;
  payment_hash: string | null;
  preimage: string | null;
  paid_at: string | null;
}

export interface InvoiceFilesResponse {
  files: Record<number, { id: string; encrypted_file_url: string; file_name: string }[]>;
}

export interface DownloadUrlResponse {
  downloadUrl: string;
}

export interface ListInvoicesResponse {
  invoices: InvoiceItem[];
  has_more: boolean;
}

export interface GetBolt11Response {
  pr: string;
  routes: unknown[];
  terms_hash: string;
}

export interface ConfirmPaymentParams {
  payment_hash: string;
  preimage: string;
  terms_hash?: string;
}

export interface ConfirmPaymentResponse {
  ok: true;
  already_settled: boolean;
}

export interface ReceiptResponse {
  receipt: {
    invoice_id: number;
    status: "settled";
    amount: number;
    currency: string;
    amount_sats: number | null;
    description: string | null;
    creator: {
      first_name: string | null;
      last_name: string | null;
      company: string | null;
    };
    created_at: string;
    settled_at: string | null;
    expires_at: string | null;
    payment_hash: string | null;
    preimage: string | null;
    receipt_verified: boolean;
    has_files: boolean;
    file_count: number;
  };
}

export interface PublicSettingsResponse {
  min_topup_sats: number;
  min_topup_usd: number | null;
  fee_percent: number;
  min_invoice_usd: number;
  max_invoice_usd: number;
  max_file_size_mb: number;
  max_files_per_invoice: number;
  btc_usd_price: number | null;
}

export interface PaymentPayload {
  protocol: "hypawave/v1";
  invoice_id: number;
  amount: number;
  currency: string;
  sats: number;
  btc_usd_rate: number;
  description: string | null;
  expires_at: string | null;
  bolt11_url: string;
  confirm_url: string;
  payment_url: string;
  spec_url: string;
  instructions_url: string;
}

export interface OfferDownloadUrlParams {
  offer_file_id: string;
  claim_token?: string;
  preimage?: string;
}

export interface WalletCapabilities {
  returnsPreimage: true | false | "conditional";
}

export interface WalletAdapter {
  capabilities: WalletCapabilities;
  payInvoice(bolt11: string): Promise<{
    payment_hash: string;
    preimage: string;
    fees_paid_msat?: number;
    raw?: unknown;
  }>;
}

export interface PayAndConfirmParams {
  invoiceId: number;
  accessToken: string;
  wallet: WalletAdapter;
  allowConditionalPreimage?: boolean;
}

export interface PayAndConfirmResult {
  payment_hash: string;
  preimage: string;
  terms_hash: string;
  fees_paid_msat?: number;
  confirmation: ConfirmPaymentResponse;
}

export interface HypawaveError {
  error: string;
  message?: string;
  field?: string;
}
