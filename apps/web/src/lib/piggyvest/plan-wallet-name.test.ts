import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildPiggyvestPlanWalletName } from './plan-wallet-name';

const identity = {
  integrationId: '44444444-4444-4444-8444-444444444444',
  goalId: '33333333-3333-4333-8333-333333333333',
};

describe('buildPiggyvestPlanWalletName', () => {
  it('keeps name parts separated when unsupported punctuation is removed', () => {
    expect(
      buildPiggyvestPlanWalletName({ ...identity, customerName: 'Ola/Chidi' })
    ).toBe('Ola Chidi Savings D4851B9412725E22');
  });
  it('uses the customer name with a stable plan-specific suffix', () => {
    expect(
      buildPiggyvestPlanWalletName({
        ...identity,
        customerName: 'Bassey Effiong',
      })
    ).toBe('Bassey Effiong Savings D4851B9412725E22');
  });

  it('keeps legacy naming byte-identical when no name was supplied', () => {
    expect(buildPiggyvestPlanWalletName(identity)).toBe(
      'bacid4851b9412725e22e51c6197d9aa09fb57d36a59'
    );
  });

  it.each([
    '',
    ' ',
    '💰',
    '\u202e',
  ])('uses a readable fallback when normalization leaves no name', (customerName) => {
    expect(buildPiggyvestPlanWalletName({ ...identity, customerName })).toBe(
      'Customer Savings D4851B9412725E22'
    );
  });

  it('preserves customer apostrophes and hyphens without adding a business prefix', () => {
    expect(
      buildPiggyvestPlanWalletName({
        ...identity,
        customerName: "Anne-Marie O'Neil",
      })
    ).toBe("Anne-Marie O'Neil Savings D4851B9412725E22");
  });
});
