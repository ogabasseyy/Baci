import { describe, expect, it } from 'vitest';
import { matchesProviderWalletName } from './provider-wallet-name';

describe('matchesProviderWalletName', () => {
  it('matches the name the sandbox listed back with the hyphens removed', () => {
    // Observed on staging.piggyvest.business, 2026-10-31.
    expect(
      matchesProviderWalletName(
        'pvbproofgoalbaciqaproof20261031',
        'pvbproof-goal-baciqa-proof-20261031'
      )
    ).toBe(true);
  });

  it.each([
    ['BACI PLAN 43E157B6 C0065070', 'BACI PLAN 43E157B6 C0065070'],
    ['BACIPLAN43E157B6C0065070', 'BACI PLAN 43E157B6 C0065070'],
    ['baciplan43e157b6c0065070', 'BACI PLAN 43E157B6 C0065070'],
    [
      'bacisave0000000000004000800000000000000400000000000040008000000000000006',
      'baci-save:00000000-0000-4000-8000-000000000004:00000000-0000-4000-8000-000000000006',
    ],
  ])('treats %j as the provider rewrite of %j', (listed, expected) => {
    expect(matchesProviderWalletName(listed, expected)).toBe(true);
  });

  it.each([
    ['BACI PLAN 43E157B6 C0065071', 'BACI PLAN 43E157B6 C0065070'],
    ['BACI PLAN 43E157B6 C00650700', 'BACI PLAN 43E157B6 C0065070'],
    ['BACI PLAN 43E157B6', 'BACI PLAN 43E157B6 C0065070'],
    ['STAGING TEST CUSTOMER', 'BACI PLAN 43E157B6 C0065070'],
    [
      'pvbproofgoalbaciqaproof20261031-p7',
      'pvbproof-goal-baciqa-proof-20261031',
    ],
  ])('does not match a different wallet %j for %j', (listed, expected) => {
    expect(matchesProviderWalletName(listed, expected)).toBe(false);
  });

  it.each([
    null,
    undefined,
    '',
  ])('does not match a missing listed name %j', (listed) => {
    expect(matchesProviderWalletName(listed, 'BACI PLAN 43E157B6')).toBe(false);
  });

  it('never matches when the expected name has no letters or digits', () => {
    expect(matchesProviderWalletName('', '---')).toBe(false);
    expect(matchesProviderWalletName(' : ', ' - ')).toBe(false);
  });
});
