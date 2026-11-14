/** A contribution: the proof is bound to goal, operation and amount. */
export type FundPinProofRequest = {
  action?: 'fund';
  merchantId?: string;
  goalId: string;
  operationId: string;
  amountKobo: number;
};

/** Cancel or complete: the server moves the whole goal, so no amount. */
export type GoalActionPinProofRequest = {
  action: 'cancel' | 'complete';
  merchantId: string;
  goalId: string;
  operationId: string;
  /** Shown on the PIN sheet only; never sent to the server. */
  goalTitle?: string;
};

export type PinProofRequest = FundPinProofRequest | GoalActionPinProofRequest;

/** Resolves a single-use proof, or null when the customer backs out. */
export type PinProofRequester = (
  request: PinProofRequest
) => Promise<string | null>;

export const PIN_CANCELLED_CODE = 'PIN_CANCELLED';
const PIN_REFUSAL_CODES = new Set(['PIN_PROOF_REQUIRED', 'PIN_PROOF_REFUSED']);
// A refused proof is single use and may have been spent by an earlier failed
// attempt, so the customer may be asked again, but not forever.
const MAX_PIN_PROMPTS = 3;

function codeOf(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
}

export function isPinCancelled(error: unknown) {
  return codeOf(error) === PIN_CANCELLED_CODE;
}

/**
 * Runs a primary contribution and, only when the server cleanly refuses it for
 * want of a PIN proof, asks the customer for the PIN and runs the same
 * operation again with the proof. The refusal means nothing moved, so the
 * retry reuses the stored operation id and rail untouched. Any other failure
 * (including an indeterminate one) is rethrown and never retried here.
 */
export async function runWithPinProof<T>(
  run: (pinProof?: string) => Promise<T>,
  request: PinProofRequest,
  requestProof?: PinProofRequester
): Promise<T> {
  let pinProof: string | undefined;
  for (let prompt = 0; ; prompt += 1) {
    try {
      return await run(pinProof);
    } catch (error) {
      const refused = PIN_REFUSAL_CODES.has(String(codeOf(error)));
      if (!refused || !requestProof || prompt >= MAX_PIN_PROMPTS) throw error;
      const proof = await requestProof(request);
      if (!proof) {
        throw Object.assign(new Error('PIN entry cancelled.'), {
          code: PIN_CANCELLED_CODE,
        });
      }
      pinProof = proof;
    }
  }
}
