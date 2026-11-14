import type { PiggyvestWebhookAlertCode } from './webhook-alerts';

/**
 * The page for each split answer that holds a cancel before anything moved
 * (a person must act). Answers not listed hold nothing.
 */
export const HOLD_PAGES: Partial<
  Record<
    string,
    {
      code: PiggyvestWebhookAlertCode;
      reason: string;
    }
  >
> = {
  needs_review: {
    code: 'PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW',
    reason: 'provider_balance_below_principal',
  },
  forfeit_unavailable: {
    code: 'PIGGYVEST_GOAL_CANCEL_FORFEIT_UNAVAILABLE',
    reason: 'interest_wallet_missing',
  },
  too_large: {
    code: 'PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW',
    reason: 'principal_above_transfer_limit',
  },
};
