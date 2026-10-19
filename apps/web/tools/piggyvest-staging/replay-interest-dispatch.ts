import type { InterestPayoutSuccessEvent } from '../../src/schemas/piggyvest/events';

export type VerifiedInterestReplayBinding = {
  providerBusinessId: string;
  providerCustomerId: string;
  interestSourceWalletId: string;
  interestPayoutWalletId: string;
  canonicalGoalId: string;
  interestEligible: boolean;
};

export type ReplayInterestDispatchPreparation = {
  status: 'deferred';
  reason:
    | 'customer-binding-mismatch'
    | 'source-wallet-binding-mismatch'
    | 'payout-wallet-binding-mismatch'
    | 'interest-eligibility-unverified'
    | 'interest-arithmetic-inconsistent'
    | 'provider-business-and-currency-unverified';
  providerPayoutId: string;
};

export function prepareReplayInterestDispatch(
  event: InterestPayoutSuccessEvent,
  binding: VerifiedInterestReplayBinding
): ReplayInterestDispatchPreparation {
  const providerPayoutId = event.eventData.id;
  if (event.customer_id !== binding.providerCustomerId) {
    return deferred('customer-binding-mismatch', providerPayoutId);
  }
  if (event.pvb_accrued_interest_wallet !== binding.interestSourceWalletId) {
    return deferred('source-wallet-binding-mismatch', providerPayoutId);
  }
  if (
    event.eventData.destination_wallet !== binding.interestPayoutWalletId ||
    (event.pvb_destination_wallet !== null &&
      event.pvb_destination_wallet !== binding.interestPayoutWalletId)
  ) {
    return deferred('payout-wallet-binding-mismatch', providerPayoutId);
  }
  if (!binding.interestEligible || binding.canonicalGoalId.length === 0) {
    return deferred('interest-eligibility-unverified', providerPayoutId);
  }

  const { gross_interest_payout, withholding_tax, net_interest_payout } =
    event.eventData.break_down;
  if (
    gross_interest_payout - withholding_tax !== net_interest_payout ||
    event.eventData.amount !== net_interest_payout
  ) {
    return deferred('interest-arithmetic-inconsistent', providerPayoutId);
  }

  return deferred(
    'provider-business-and-currency-unverified',
    providerPayoutId
  );
}

function deferred(
  reason: ReplayInterestDispatchPreparation['reason'],
  providerPayoutId: string
): ReplayInterestDispatchPreparation {
  return { status: 'deferred', reason, providerPayoutId };
}
