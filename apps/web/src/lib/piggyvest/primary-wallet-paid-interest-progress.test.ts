import { describe, expect, it } from 'vitest';
import { projectPrimaryWalletPaidInterestProgress } from './primary-wallet-paid-interest-progress';

const fundedGoal = {
  principalKobo: 10_000,
  paidEligibleInterestKobo: 3_000,
  pendingInterestKobo: 500,
  targetKobo: 13_000,
  reservedContributionKobo: 0,
  status: 'active' as const,
};

describe('primary wallet paid-interest goal completion', () => {
  it('completes a goal funded by principal plus verified net payout without increasing principal', () => {
    const result = projectPrimaryWalletPaidInterestProgress(fundedGoal);

    expect(result).toEqual({
      principalKobo: 10_000,
      paidEligibleInterestKobo: 3_000,
      pendingInterestKobo: 500,
      fundedKobo: 13_000,
      remainingTargetKobo: 0,
      contributionCapacityKobo: 0,
      targetReached: true,
      status: 'completed',
      savingsInterestWalletCreditKobo: 0,
    });
    expect(fundedGoal.principalKobo).toBe(10_000);
  });

  it('leaves daily accrual outside funded totals and contribution capacity', () => {
    const result = projectPrimaryWalletPaidInterestProgress({
      ...fundedGoal,
      paidEligibleInterestKobo: 0,
      pendingInterestKobo: 50_000,
    });

    expect(result.fundedKobo).toBe(10_000);
    expect(result.contributionCapacityKobo).toBe(3_000);
    expect(result.status).toBe('active');
    expect(result.savingsInterestWalletCreditKobo).toBe(0);
  });

  it('subtracts partial paid interest and pending contributions from new contribution capacity', () => {
    const result = projectPrimaryWalletPaidInterestProgress({
      ...fundedGoal,
      paidEligibleInterestKobo: 700,
      reservedContributionKobo: 1_000,
    });

    expect(result.fundedKobo).toBe(10_700);
    expect(result.remainingTargetKobo).toBe(2_300);
    expect(result.contributionCapacityKobo).toBe(1_300);
    expect(result.status).toBe('active');
  });

  it('does not complete a goal from an accepted or dispatched contribution', () => {
    const result = projectPrimaryWalletPaidInterestProgress({
      ...fundedGoal,
      paidEligibleInterestKobo: 0,
      reservedContributionKobo: 3_000,
    });

    expect(result.targetReached).toBe(false);
    expect(result.status).toBe('active');
    expect(result.contributionCapacityKobo).toBe(0);
  });

  it('clamps capacity when a payout arrives after a contribution was reserved', () => {
    const result = projectPrimaryWalletPaidInterestProgress({
      ...fundedGoal,
      reservedContributionKobo: 3_000,
    });

    expect(result.contributionCapacityKobo).toBe(0);
    expect(result.status).toBe('completed');
  });

  it('preserves excess verified interest instead of capping funded value at the target', () => {
    const result = projectPrimaryWalletPaidInterestProgress({
      ...fundedGoal,
      paidEligibleInterestKobo: 5_000,
    });

    expect(result.fundedKobo).toBe(15_000);
    expect(result.remainingTargetKobo).toBe(0);
    expect(result.contributionCapacityKobo).toBe(0);
  });

  it('pauses a completed goal after an interest reversal reduces verified funded totals', () => {
    const result = projectPrimaryWalletPaidInterestProgress({
      ...fundedGoal,
      status: 'completed',
      paidEligibleInterestKobo: 0,
    });

    expect(result.status).toBe('paused');
    expect(result.remainingTargetKobo).toBe(3_000);
  });

  it.each([
    'paused',
    'cancelled',
    'purchase_pending',
    'spent',
  ] as const)('preserves the %s lifecycle when totals are below target', (status) => {
    const result = projectPrimaryWalletPaidInterestProgress({
      ...fundedGoal,
      paidEligibleInterestKobo: 0,
      status,
    });

    expect(result.status).toBe(status);
    expect(result.contributionCapacityKobo).toBe(
      status === 'paused' ? 3_000 : 0
    );
  });

  it.each([
    'cancelled',
    'purchase_pending',
    'spent',
  ] as const)('does not resurrect a %s goal on payout', (status) => {
    expect(
      projectPrimaryWalletPaidInterestProgress({ ...fundedGoal, status }).status
    ).toBe(status);
  });

  it('returns identical progress on repeated reads of the same verified totals', () => {
    expect(projectPrimaryWalletPaidInterestProgress(fundedGoal)).toEqual(
      projectPrimaryWalletPaidInterestProgress(fundedGoal)
    );
  });

  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid kobo value %s', (amount) => {
    for (const field of [
      'principalKobo',
      'paidEligibleInterestKobo',
      'pendingInterestKobo',
      'targetKobo',
      'reservedContributionKobo',
    ] as const) {
      expect(() =>
        projectPrimaryWalletPaidInterestProgress({
          ...fundedGoal,
          [field]: amount,
        })
      ).toThrow('Invalid savings progress');
    }
  });

  it('rejects zero targets and overflow of verified funded totals', () => {
    expect(() =>
      projectPrimaryWalletPaidInterestProgress({ ...fundedGoal, targetKobo: 0 })
    ).toThrow('Invalid savings progress');
    expect(() =>
      projectPrimaryWalletPaidInterestProgress({
        ...fundedGoal,
        principalKobo: Number.MAX_SAFE_INTEGER,
      })
    ).toThrow('Invalid savings progress');
  });
});
