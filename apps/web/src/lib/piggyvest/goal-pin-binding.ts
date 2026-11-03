import { deriveWalletPinIdempotencyDigest } from '@/lib/wallet-pin/wallet-pin-kdf';

export type GoalPinBindingInput =
  | {
      action: 'fund';
      goalId: string;
      operationId: string;
      amountKobo: number;
    }
  | { action: 'cancel' | 'complete'; goalId: string };

export type GoalPinPurpose = 'goal_fund' | 'goal_cancel' | 'goal_complete';

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
 * The key text the database hashes itself: the operation id for funding
 * (reserve_savings_with_pin), '<goalId>:<action>' for cancel and complete
 * (consume_goal_pin_proof). Both sides use lower-case UUIDs.
 */
export function buildGoalPinBinding(
  input: GoalPinBindingInput
): GoalPinBinding {
  if (input.action === 'fund') {
    return {
      purpose: 'goal_fund',
      amountKobo: input.amountKobo,
      idempotencyKeySha256: deriveWalletPinIdempotencyDigest(
        input.operationId.toLowerCase()
      ),
    };
  }
  return {
    purpose: input.action === 'cancel' ? 'goal_cancel' : 'goal_complete',
    amountKobo: GOAL_PIN_WHOLE_BALANCE_MARKER_KOBO,
    idempotencyKeySha256: deriveWalletPinIdempotencyDigest(
      `${input.goalId.toLowerCase()}:${input.action}`
    ),
  };
}
