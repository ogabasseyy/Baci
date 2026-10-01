import { describe, expect, it } from 'vitest';
import { parseSocialAdsAccounts } from './social-ads-account-parser';

describe('parseSocialAdsAccounts', () => {
  it('keeps valid public account fields and rejects malformed rows', () => {
    expect(
      parseSocialAdsAccounts([
        {
          accountId: 'account-1',
          currencyCode: 'NGN',
          label: 'Primary',
          selected: true,
          timezoneName: 'Africa/Lagos',
        },
        { accountId: 'missing-label' },
        null,
      ])
    ).toEqual([
      {
        accountId: 'account-1',
        currencyCode: 'NGN',
        label: 'Primary',
        selected: true,
        timezoneName: 'Africa/Lagos',
      },
    ]);
    expect(parseSocialAdsAccounts({})).toEqual([]);
  });
});
