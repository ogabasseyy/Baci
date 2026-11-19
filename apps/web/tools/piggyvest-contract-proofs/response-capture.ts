import type { HarnessRefusal } from './safety-guards';

/**
 * Side channel for the guarded fetch. The typed clients strip fields and
 * the shared request helper hides the HTTP status, so the guard records the
 * last response (status + parsed envelope) for shape analysis. The raw
 * envelope lives in memory only and is never persisted.
 */

export interface CapturedResponse {
  method: string;
  pathname: string;
  httpStatus: number;
  /** Parsed JSON body, or null if the body was not JSON. */
  envelope: unknown;
}

export class ResponseCapture {
  private response: CapturedResponse | null = null;
  private refusal: HarnessRefusal | null = null;

  reset(): void {
    this.response = null;
    this.refusal = null;
  }

  record(response: CapturedResponse): void {
    this.response = response;
  }

  /** Typed clients wrap fetch errors; keep the refusal so callers can rethrow it. */
  recordRefusal(refusal: HarnessRefusal): void {
    this.refusal = refusal;
  }

  take(): {
    response: CapturedResponse | null;
    refusal: HarnessRefusal | null;
  } {
    const taken = { response: this.response, refusal: this.refusal };
    this.reset();
    return taken;
  }
}
