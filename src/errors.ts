export class HypawaveAPIError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly field?: string;

  constructor(status: number, body: { error: string; message?: string; field?: string }) {
    super(body.message || body.error);
    this.name = "HypawaveAPIError";
    this.status = status;
    this.code = body.error;
    this.field = body.field;
  }

  get isAuth() {
    return this.status === 401;
  }

  get isRateLimit() {
    return this.status === 429;
  }

  get isValidation() {
    return this.code === "validation_error";
  }

  get isOutstandingFee() {
    return this.status === 402;
  }
}
