import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { Hypawave, HypawaveAPIError } from "../src/index";
import type { WalletAdapter } from "../src/types";

// ── Test helpers ──────────────────────────────────────────────────────────

/** Build a minimal fetch Response stand-in. `nonJson: true` makes .json() throw. */
function mockRes(
  status: number,
  body: unknown,
  opts: { nonJson?: boolean; headers?: Record<string, string | number> } = {}
) {
  const lower = Object.fromEntries(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    json: async () => {
      if (opts.nonJson) throw new SyntaxError("Unexpected token < in JSON");
      return body;
    },
  };
}

const PREIMAGE = "ab".repeat(32); // valid 64-char hex
const EXPECTED_HASH = createHash("sha256").update(Buffer.from(PREIMAGE, "hex")).digest("hex");

function wallet(
  returnsPreimage: WalletAdapter["capabilities"]["returnsPreimage"],
  payResult: { preimage: string; payment_hash: string; fees_paid_msat?: number }
): WalletAdapter {
  return {
    capabilities: { returnsPreimage },
    payInvoice: vi.fn(async () => payResult),
  };
}

/** Returns the error a rejected promise threw (instead of asserting via .rejects). */
async function caught(p: Promise<unknown>): Promise<any> {
  return p.then(
    () => {
      throw new Error("expected promise to reject");
    },
    (e) => e
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
let client: Hypawave;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Zero out jitter so backoff sleeps are 0ms under real timers (fast tests).
  // Tests that assert an exact delay use the deterministic Retry-After path.
  vi.spyOn(Math, "random").mockReturnValue(0);
  client = new Hypawave({ apiKey: "sk_test_abc" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Retry matrix ────────────────────────────────────────────────────────────

describe("retry matrix", () => {
  it("retries a GET on 5xx, then succeeds", async () => {
    fetchMock.mockResolvedValueOnce(mockRes(503, { error: "x" })).mockResolvedValueOnce(mockRes(200, { ok: true }));
    await client.getSettings();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a GET on a network error, then succeeds", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down")).mockResolvedValueOnce(mockRes(200, { ok: true }));
    await client.getBalance();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 429 even for a non-retry-safe POST (createInvoice)", async () => {
    fetchMock.mockResolvedValueOnce(mockRes(429, { error: "rate_limit_exceeded" })).mockResolvedValueOnce(mockRes(200, { ok: true }));
    await client.createInvoice({} as any);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-retry-safe POST on 5xx", async () => {
    fetchMock.mockResolvedValue(mockRes(503, { error: "down" }));
    const err = await caught(client.createInvoice({} as any));
    expect(err).toBeInstanceOf(HypawaveAPIError);
    expect(err.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a non-retry-safe POST on a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    const err = await caught(client.createInvoice({} as any));
    expect(err).toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── Retry cap ────────────────────────────────────────────────────────────────

describe("retry cap", () => {
  it("gives up after maxRetries (default 3 → 4 total attempts)", async () => {
    fetchMock.mockResolvedValue(mockRes(503, { error: "down" }));
    const err = await caught(client.getSettings());
    expect(err).toBeInstanceOf(HypawaveAPIError);
    expect(err.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("maxRetries: 0 disables retries", async () => {
    const noRetry = new Hypawave({ apiKey: "sk_test_abc", maxRetries: 0 });
    fetchMock.mockResolvedValue(mockRes(503, { error: "down" }));
    await caught(noRetry.getSettings());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── Retry-After header (deterministic delay) ─────────────────────────────────

describe("Retry-After", () => {
  it("waits for the Retry-After header duration before retrying", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(mockRes(429, { error: "rate_limit_exceeded" }, { headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(mockRes(200, { ok: true }));

    const p = client.getSettings();
    await vi.advanceTimersByTimeAsync(0); // resolve first fetch, schedule backoff
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999); // not yet
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1); // 2s elapsed → retry fires
    await p;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── Non-JSON bodies ──────────────────────────────────────────────────────────

describe("non-JSON bodies", () => {
  it("throws a clean HypawaveAPIError on a 200 with a non-JSON body", async () => {
    fetchMock.mockResolvedValue(mockRes(200, null, { nonJson: true }));
    const err = await caught(client.getSettings());
    expect(err).toBeInstanceOf(HypawaveAPIError);
    expect(err.status).toBe(200);
    expect(err.code).toBe("invalid_response");
    expect(fetchMock).toHaveBeenCalledTimes(1); // 200 is not retried
  });

  it("treats a non-JSON 502 as a retryable clean error (overloaded proxy)", async () => {
    fetchMock.mockResolvedValue(mockRes(502, "<html>Bad Gateway</html>", { nonJson: true }));
    const err = await caught(client.getSettings());
    expect(err).toBeInstanceOf(HypawaveAPIError);
    expect(err.status).toBe(502);
    expect(err.code).toBe("http_502");
    expect(fetchMock).toHaveBeenCalledTimes(4); // retried, not a SyntaxError crash
  });
});

// ── getUnlockStatus opts into retry-safe ─────────────────────────────────────

describe("getUnlockStatus", () => {
  it("retries on 5xx despite being a POST (read-only, retry-safe)", async () => {
    fetchMock.mockResolvedValueOnce(mockRes(503, { error: "down" })).mockResolvedValueOnce(mockRes(200, { statuses: {} }));
    await client.getUnlockStatus([1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── Query param serialization ────────────────────────────────────────────────

describe("query params", () => {
  it("serializes numbers/booleans and omits undefined", async () => {
    fetchMock.mockResolvedValue(mockRes(200, { ok: true }));
    await (client as any).request("GET", "/x", undefined, { a: true, b: false, n: 5, s: "hi", u: undefined });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("a=true");
    expect(url).toContain("b=false");
    expect(url).toContain("n=5");
    expect(url).toContain("s=hi");
    expect(url).not.toContain("u=");
  });

  it("omits undefined optional params on real methods (listInvoices)", async () => {
    fetchMock.mockResolvedValue(mockRes(200, { invoices: [] }));
    await client.listInvoices({ limit: 5 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("limit=5");
    expect(url).not.toContain("offset");
    expect(url).not.toContain("status");
  });
});

// ── payAndConfirm ────────────────────────────────────────────────────────────

describe("payAndConfirm", () => {
  beforeEach(() => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/api/paystream-cb")) {
        return Promise.resolve(mockRes(200, { pr: "lnbc1test", routes: [], terms_hash: "th_abc" }));
      }
      if (u.includes("/confirm")) {
        return Promise.resolve(mockRes(200, { ok: true, already_settled: false }));
      }
      return Promise.resolve(mockRes(404, { error: "not_found" }));
    });
  });

  it("rejects a wallet that cannot return the preimage", async () => {
    const w = wallet(false, { preimage: PREIMAGE, payment_hash: EXPECTED_HASH });
    const err = await caught(client.payAndConfirm({ invoiceId: 42, accessToken: "tok", wallet: w }));
    expect(err.code).toBe("wallet_no_preimage_support");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(w.payInvoice).not.toHaveBeenCalled();
  });

  it("blocks a conditional-preimage wallet unless explicitly allowed", async () => {
    const w = wallet("conditional", { preimage: PREIMAGE, payment_hash: EXPECTED_HASH });
    const err = await caught(client.payAndConfirm({ invoiceId: 42, accessToken: "tok", wallet: w }));
    expect(err.code).toBe("wallet_conditional_preimage");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proceeds with a conditional wallet when allowConditionalPreimage is set", async () => {
    const w = wallet("conditional", { preimage: PREIMAGE, payment_hash: EXPECTED_HASH, fees_paid_msat: 1000 });
    const result = await client.payAndConfirm({
      invoiceId: 42,
      accessToken: "tok",
      wallet: w,
      allowConditionalPreimage: true,
    });
    expect(result.confirmation.ok).toBe(true);
    expect(result.payment_hash).toBe(EXPECTED_HASH);
  });

  it("rejects an invalid (non-hex) preimage", async () => {
    const w = wallet(true, { preimage: "nothex", payment_hash: "" });
    const err = await caught(client.payAndConfirm({ invoiceId: 42, accessToken: "tok", wallet: w }));
    expect(err.code).toBe("wallet_did_not_return_preimage");
  });

  it("rejects a payment_hash that does not match SHA256(preimage)", async () => {
    const w = wallet(true, { preimage: PREIMAGE, payment_hash: "00".repeat(32) });
    const err = await caught(client.payAndConfirm({ invoiceId: 42, accessToken: "tok", wallet: w }));
    expect(err.code).toBe("preimage_hash_mismatch");
  });

  it("falls back to the computed hash when the wallet omits payment_hash", async () => {
    const w = wallet(true, { preimage: PREIMAGE, payment_hash: "", fees_paid_msat: 2000 });
    const result = await client.payAndConfirm({ invoiceId: 42, accessToken: "tok", wallet: w });
    expect(result.payment_hash).toBe(EXPECTED_HASH);

    const confirmCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/invoice/42/confirm"));
    const body = JSON.parse(confirmCall![1].body);
    expect(body.payment_hash).toBe(EXPECTED_HASH);
  });

  it("confirms on the happy path with a matching preimage and hash", async () => {
    const w = wallet(true, { preimage: PREIMAGE, payment_hash: EXPECTED_HASH, fees_paid_msat: 1500 });
    const result = await client.payAndConfirm({ invoiceId: 42, accessToken: "tok", wallet: w });

    expect(result.payment_hash).toBe(EXPECTED_HASH);
    expect(result.preimage).toBe(PREIMAGE);
    expect(result.terms_hash).toBe("th_abc");
    expect(result.fees_paid_msat).toBe(1500);
    expect(result.confirmation.ok).toBe(true);

    const confirmCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/invoice/42/confirm"));
    const body = JSON.parse(confirmCall![1].body);
    expect(body).toMatchObject({ payment_hash: EXPECTED_HASH, preimage: PREIMAGE, terms_hash: "th_abc" });
  });
});
