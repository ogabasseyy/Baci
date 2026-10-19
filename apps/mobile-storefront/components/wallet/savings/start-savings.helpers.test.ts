import { describe, expect, it } from '@jest/globals';
import {
  calculateMaturityDate,
  formatDateInput,
  getEffectiveInitialContribution,
  getRequiredTopUp,
  getSavingsReminderScheduledAt,
  normalizeAmountInput,
  parseAmount,
} from './start-savings.helpers';

describe('start savings helpers', () => {
  it('normalizes numeric amount inputs', () => {
    expect(normalizeAmountInput('₦20,000.55')).toBe('2000055');
  });

  it('parses valid amount input', () => {
    expect(parseAmount('20000')).toBe(20000);
  });

  it('returns zero for blank amount input', () => {
    expect(parseAmount('')).toBe(0);
  });

  it('returns zero for non-numeric amount input', () => {
    expect(parseAmount('abc')).toBe(0);
  });

  it('trims ISO date input to the date portion', () => {
    expect(formatDateInput('2026-05-21T12:30:00.000Z')).toBe('2026-05-21');
  });

  it('returns blank for invalid date input', () => {
    expect(formatDateInput('not-a-date')).toBe('');
    expect(formatDateInput('2026-99-99')).toBe('');
  });

  it('combines savings reminder start date and preferred debit time', () => {
    expect(
      getSavingsReminderScheduledAt({
        preferredDebitTime: '07:45',
        startDate: '2026-05-22',
      })
    ).toEqual(new Date('2026-05-22T07:45:00'));
  });

  it('falls back to start-of-day for invalid savings reminder times', () => {
    expect(
      getSavingsReminderScheduledAt({
        preferredDebitTime: 'bad-time',
        startDate: '2026-05-22',
      })
    ).toEqual(new Date('2026-05-22T00:00:00'));
  });

  it('calculates maturity date from contribution cycles', () => {
    expect(
      calculateMaturityDate({
        contributionAmount: 20000,
        frequency: 'daily',
        startDate: '2026-05-21',
        targetAmount: 800000,
      })
    ).toBe('2026-06-29');

    expect(
      calculateMaturityDate({
        contributionAmount: 50000,
        frequency: 'weekly',
        startDate: '2026-05-21',
        targetAmount: 800000,
      })
    ).toBe('2026-09-03');
  });

  it('matures on the start date when the first contribution reaches the target', () => {
    expect(
      calculateMaturityDate({
        contributionAmount: 800000,
        frequency: 'daily',
        startDate: '2026-05-21',
        targetAmount: 800000,
      })
    ).toBe('2026-05-21');
  });

  it('uses calendar months for monthly maturity dates', () => {
    expect(
      calculateMaturityDate({
        contributionAmount: 100000,
        frequency: 'monthly',
        startDate: '2026-01-31',
        targetAmount: 300000,
      })
    ).toBe('2026-03-31');
  });

  it('preserves end-of-month monthly semantics for shorter target months', () => {
    expect(
      calculateMaturityDate({
        contributionAmount: 100000,
        frequency: 'monthly',
        startDate: '2026-01-31',
        targetAmount: 200000,
      })
    ).toBe('2026-02-28');
  });

  it('clamps non-end-of-month monthly maturity dates to the target month length', () => {
    expect(
      calculateMaturityDate({
        contributionAmount: 100000,
        frequency: 'monthly',
        startDate: '2026-01-30',
        targetAmount: 200000,
      })
    ).toBe('2026-02-28');
  });

  it('does not require an initial wallet contribution when disabled', () => {
    expect(
      getEffectiveInitialContribution({
        contributionAmount: 20000,
        fundingOption: 'wallet',
        initialContributionAmount: 0,
        initialContributionEnabled: false,
      })
    ).toBe(0);
  });

  it('uses the contribution amount as the transfer-funded first deposit', () => {
    expect(
      getEffectiveInitialContribution({
        contributionAmount: 20000,
        fundingOption: 'bank_transfer',
        initialContributionAmount: 0,
        initialContributionEnabled: false,
      })
    ).toBe(20000);
  });

  it('uses the explicit initial wallet contribution when enabled', () => {
    expect(
      getEffectiveInitialContribution({
        contributionAmount: 20000,
        fundingOption: 'wallet',
        initialContributionAmount: 50000,
        initialContributionEnabled: true,
      })
    ).toBe(50000);
  });

  it('computes the required top-up difference', () => {
    expect(
      getRequiredTopUp({ availableBalance: 6000, requiredContribution: 20000 })
    ).toBe(14000);
  });

  it('does not return a negative top-up', () => {
    expect(
      getRequiredTopUp({ availableBalance: 50000, requiredContribution: 20000 })
    ).toBe(0);
  });

  it('returns null when contribution amount is zero', () => {
    expect(
      calculateMaturityDate({
        contributionAmount: 0,
        frequency: 'daily',
        startDate: '2026-05-21',
        targetAmount: 800000,
      })
    ).toBeNull();
  });

  it('returns null when target amount is zero', () => {
    expect(
      calculateMaturityDate({
        contributionAmount: 20000,
        frequency: 'daily',
        startDate: '2026-05-21',
        targetAmount: 0,
      })
    ).toBeNull();
  });

  it('returns null when zero-contribution fallback receives an invalid date', () => {
    expect(
      calculateMaturityDate({
        contributionAmount: 0,
        frequency: 'daily',
        startDate: '2026-99-99',
        targetAmount: 800000,
      })
    ).toBeNull();
  });

  it('returns null when maturity calculation receives an invalid positive-contribution start date', () => {
    expect(
      calculateMaturityDate({
        contributionAmount: 20000,
        frequency: 'daily',
        startDate: 'not-a-date',
        targetAmount: 800000,
      })
    ).toBeNull();
  });
});
