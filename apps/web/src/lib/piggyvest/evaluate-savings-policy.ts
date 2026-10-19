import {
  applicablePriceKobo,
  isActivated,
  isReady,
  purchasingPowerKobo,
} from '@baci/shared/piggyvest';
import {
  type PiggyvestSavingsPolicyInput,
  piggyvestSavingsPolicyInputSchema,
} from '@/schemas/piggyvest-savings-policy';
import type { SavingsPolicyDecision } from './evaluate-savings-policy.types';

function sameDevice(
  left: PiggyvestSavingsPolicyInput['device'],
  right: PiggyvestSavingsPolicyInput['device']
): boolean {
  return (
    left.productId === right.productId &&
    left.variantId === right.variantId &&
    left.condition === right.condition
  );
}

export function evaluateSavingsPolicy(input: unknown): SavingsPolicyDecision {
  const policy = piggyvestSavingsPolicyInputSchema.parse(input);
  const now = new Date(policy.now);
  for (const offer of [
    policy.currentOffer,
    policy.activationQuote,
    policy.guarantee,
    policy.protectedOffer,
  ]) {
    if (offer && !sameDevice(policy.device, offer.device))
      throw new Error('Savings offer device mismatch');
  }
  const principal =
    policy.ledger.confirmedPrincipalKobo - policy.ledger.reservedPrincipalKobo;
  const paidInterest =
    policy.ledger.paidEligibleInterestKobo -
    policy.ledger.reservedPaidInterestKobo;
  const purchasingPower = purchasingPowerKobo(principal, paidInterest);
  const price = applicablePriceKobo({
    guaranteedPriceKobo:
      policy.guarantee?.priceKobo ?? policy.currentOffer.priceKobo,
    currentPriceKobo: policy.currentOffer.priceKobo,
    ...(policy.protectedOffer
      ? {
          protectedOfferPriceKobo: policy.protectedOffer.priceKobo,
          protectedOfferExpiresAt: new Date(policy.protectedOffer.expiresAt),
        }
      : {}),
    now,
  });
  const graceExpired = Boolean(
    policy.maturityGraceExpiresAt &&
      now.getTime() >= Date.parse(policy.maturityGraceExpiresAt)
  );
  const decision: SavingsPolicyDecision = {
    purchasingPowerKobo: purchasingPower,
    devicePriceKobo: price,
    surplusKobo: Math.max(0, purchasingPower - price),
    activation: 'not_available',
    readiness: 'not_available',
    purchaseAction: 'blocked',
    collectionAction: 'pause',
    transition: 'not_requested',
    maturity: graceExpired ? 'review_required' : 'within_policy',
    cancellation: { status: 'not_requested' },
  };
  if (policy.goalState === 'purchased' || policy.goalState === 'cancelled') {
    decision.transition = 'not_allowed_for_goal_state';
    return decision;
  }
  if (
    policy.reservation !== 'none' ||
    policy.goalState === 'purchase_pending' ||
    policy.goalState === 'cancellation_pending'
  ) {
    decision.transition = 'blocked_by_existing_reservation';
    return decision;
  }
  if (policy.fundingReversed || graceExpired) {
    decision.readiness = 'review_required';
    decision.transition = 'review_required';
    return decision;
  }
  if (!policy.hasBeforeFundingConsent) return decision;
  if (
    policy.requestedAction === 'device_change' ||
    (policy.requestedAction === 'activate' && policy.goalState !== 'draft') ||
    (policy.requestedAction === 'checkout' && policy.goalState === 'draft')
  ) {
    decision.transition = 'not_allowed_for_goal_state';
    return decision;
  }
  if (policy.requestedAction === 'cancel') {
    decision.cancellation = {
      status: 'quote_available',
      principalRefundKobo: principal,
      paidInterestForfeitureKobo: paidInterest,
      pendingInterestCancelledKobo: policy.ledger.pendingInterestKobo,
    };
    decision.transition = 'requires_customer_confirmation';
    return decision;
  }
  if (policy.goalState === 'draft') {
    if (
      policy.activationQuote &&
      now.getTime() < Date.parse(policy.activationQuote.expiresAt) &&
      isActivated(principal, policy.activationQuote.priceKobo)
    ) {
      decision.activation = 'activate';
    }
    return decision;
  }
  if (isReady(purchasingPower, price)) {
    decision.readiness = 'ready_for_review';
    decision.purchaseAction = 'requires_customer_confirmation';
  } else {
    decision.readiness = 'continue_saving';
    decision.collectionAction = policy.collectionPaused ? 'pause' : 'none';
  }
  return decision;
}
