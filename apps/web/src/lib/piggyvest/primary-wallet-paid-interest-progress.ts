type GoalStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'purchase_pending'
  | 'cancellation_pending'
  | 'cancelled'
  | 'spent';

type VerifiedGoalTotals = {
  principalKobo: number;
  paidEligibleInterestKobo: number;
  pendingInterestKobo: number;
  targetKobo: number;
  reservedContributionKobo: number;
  status: GoalStatus;
};

export function projectPrimaryWalletPaidInterestProgress(
  totals: Readonly<VerifiedGoalTotals>
): {
  principalKobo: number;
  paidEligibleInterestKobo: number;
  pendingInterestKobo: number;
  fundedKobo: number;
  remainingTargetKobo: number;
  contributionCapacityKobo: number;
  targetReached: boolean;
  status: GoalStatus;
  savingsInterestWalletCreditKobo: 0;
} {
  const amounts = [
    totals.principalKobo,
    totals.paidEligibleInterestKobo,
    totals.pendingInterestKobo,
    totals.targetKobo,
    totals.reservedContributionKobo,
  ];
  const fundedKobo = totals.principalKobo + totals.paidEligibleInterestKobo;
  if (
    amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0) ||
    totals.targetKobo === 0 ||
    !Number.isSafeInteger(fundedKobo)
  ) {
    throw new Error('Invalid savings progress');
  }

  const targetReached = fundedKobo >= totals.targetKobo;
  const remainingTargetKobo = Math.max(0, totals.targetKobo - fundedKobo);
  let status = totals.status;
  if (status === 'active' || status === 'paused' || status === 'completed') {
    if (targetReached) status = 'completed';
    else if (status === 'completed') status = 'paused';
  }
  const contributionCapacityKobo =
    status === 'active' || status === 'paused'
      ? Math.max(0, remainingTargetKobo - totals.reservedContributionKobo)
      : 0;

  return {
    principalKobo: totals.principalKobo,
    paidEligibleInterestKobo: totals.paidEligibleInterestKobo,
    pendingInterestKobo: totals.pendingInterestKobo,
    fundedKobo,
    remainingTargetKobo,
    contributionCapacityKobo,
    targetReached,
    status,
    savingsInterestWalletCreditKobo: 0,
  };
}
