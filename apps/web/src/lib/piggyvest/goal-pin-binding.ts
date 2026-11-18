import { deriveWalletPinIdempotencyDigest } from '@/lib/wallet-pin/wallet-pin-kdf';

export type GoalPinBindingInput =
  | {
      action: 'fund';
      goalId: string;
      operationId: string;
      amountKobo: number;
    }
  | { action: 'cancel'; goalId: string; operationId: string }
  | { action: 'complete'; goalId: string; operationId: string };

// wallet_pay: a PiggyVest wallet payment (binding built by wallet-pay-service).
export type GoalPinPurpose =
  | 'goal_fund'
  | 'goal_cancel'
  | 'goal_complete'
  | 'wallet_pay';

export type GoalPinBinding = {
  purpose: GoalPinPurpose;
  amountKobo: number;
  idempotencyKeySha256: string;
};

/**
 * Cancel and complete move the whole balance PiggyVest reports at that
 * moment, which the customer cannot know when they type the PIN. Their
 * proofs bind this fixed marker instead of an amount; the goal and action are
 * bound through the idempotency key. Must equal the 1 used by
 * piggyvest_primary.consume_goal_pin_proof.
 */
export const GOAL_PIN_WHOLE_BALANCE_MARKER_KOBO = 1;

/**
 * The key text the database hashes itself, with lower-case UUIDs on both
 * sides: '<goalId>:<operationId>' for funding (reserve_savings_with_pin),
 * '<goalId>:cancel:<operationId>' for cancel (reserve_goal_cancel_with_pin;
 * the operation id is issued by the server per attempt, so a cancel proof is
 * good for one attempt only) and '<goalId>:complete:<operationId>' for
 * complete (reserve_goal_complete_with_pin, issued the same way).
 */
export function buildGoalPinBinding(
  input: GoalPinBindingInput
): GoalPinBinding {
  if (input.action === 'fund') {
    return {
      purpose: 'goal_fund',
      amountKobo: input.amountKobo,
      idempotencyKeySha256: deriveWalletPinIdempotencyDigest(
        `${input.goalId.toLowerCase()}:${input.operationId.toLowerCase()}`
      ),
    };
  }
  if (input.action === 'cancel') {
    return {
      purpose: 'goal_cancel',
      amountKobo: GOAL_PIN_WHOLE_BALANCE_MARKER_KOBO,
      idempotencyKeySha256: deriveWalletPinIdempotencyDigest(
        `${input.goalId.toLowerCase()}:cancel:${input.operationId.toLowerCase()}`
      ),
    };
  }
  return {
    purpose: 'goal_complete',
    amountKobo: GOAL_PIN_WHOLE_BALANCE_MARKER_KOBO,
    idempotencyKeySha256: deriveWalletPinIdempotencyDigest(
      `${input.goalId.toLowerCase()}:complete:${input.operationId.toLowerCase()}`
    ),
  };
}
