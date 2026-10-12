export type SavingsPolicyDecision = {
  purchasingPowerKobo: number;
  devicePriceKobo: number;
  surplusKobo: number;
  activation: 'activate' | 'not_available';
  readiness:
    | 'continue_saving'
    | 'ready_for_review'
    | 'review_required'
    | 'not_available';
  purchaseAction:
    | 'blocked'
    | 'not_available'
    | 'requires_customer_confirmation';
  collectionAction: 'pause' | 'none';
  transition:
    | 'not_allowed_for_goal_state'
    | 'blocked_by_existing_reservation'
    | 'review_required'
    | 'requires_customer_confirmation'
    | 'not_requested';
  maturity: 'within_policy' | 'review_required';
  cancellation:
    | { status: 'not_requested' }
    | {
        status: 'quote_available';
        principalRefundKobo: number;
        paidInterestForfeitureKobo: number;
        pendingInterestCancelledKobo: number;
      };
};
