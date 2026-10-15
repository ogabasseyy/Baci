/**
 * Kuda outcome-unknown classification (Codex R102 P1).
 *
 * When Kuda accepts an ADMIN_PURCHASE_BILL request but the response
 * times out or the connection drops, the vend may still have landed:
 * finalizing the row as failed refunds the customer on top of the
 * delivered value. Only a definitive 4xx rejection proves failure;
 * every other throw inside the purchase attempt leaves the outcome
 * unknown, so the purchase functions map it to `status: 'pending'`
 * and the existing processing path + BILL_TSQ reconciliation
 * converge the row (a stuck-pending row is a visible ops state,
 * never a silent double-spend).
 *
 * The exception is a failure BEFORE dispatch (Codex R103 P1):
 * when `GetToken` times out or rejects, no provider request was
 * ever sent, so the outcome is known-absent, not unknown — mapping
 * it to pending would strand the row in processing with a
 * never-submitted reference TSQ cannot resolve. Token acquisition
 * throws `KudaPreDispatchError`, which the classifier below maps to
 * known failure (safe retry/refund).
 */
export class KudaPreDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KudaPreDispatchError';
  }
}

export class KudaApiHttpError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`Kuda API request failed: ${statusText}`);
    this.name = 'KudaApiHttpError';
    this.status = status;
  }
}

export function isKudaOutcomeUnknown(error: unknown): boolean {
  if (error instanceof KudaPreDispatchError) {
    // Nothing was dispatched: no vend could have landed. Known
    // failure — safe to retry or refund, never ambiguous.
    return false;
  }
  if (error instanceof KudaApiHttpError) {
    // Definitive rejection (unknown reference, bad amount, …) —
    // safe to fail and refund. 5xx may have landed: unknown.
    return error.status >= 500;
  }
  // Timeout (Error('…timed out') and DOMException aborts, which skip
  // the instanceof Error conversion in kudaRequest), connection
  // drops (fetch TypeErrors), malformed bodies (JSON SyntaxError),
  // and anything else thrown post-attempt: the request may have
  // landed, so the outcome is unknown.
  return true;
}
