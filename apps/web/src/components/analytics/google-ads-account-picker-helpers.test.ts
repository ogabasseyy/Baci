import { describe, expect, it } from 'vitest';
import {
  parseGoogleAdsAccounts,
  parseGoogleAdsSyncRun,
  readGoogleAdsError,
} from './google-ads-account-picker-helpers';

describe('Google Ads account picker helpers', () => {
  it('parses only valid account entries and preserves selection state', () => {
    expect(
      parseGoogleAdsAccounts({
        accounts: [
          { customerId: '1234567890', selected: true },
          { customerId: '5555555555', selected: false },
          { customerId: 1234567890, selected: true },
          null,
        ],
      })
    ).toEqual([
      { customerId: '1234567890', selected: true },
      { customerId: '5555555555', selected: false },
    ]);
    expect(parseGoogleAdsAccounts({ accounts: 'invalid' })).toEqual([]);
  });

  it('accepts a complete server-owned sync run only', () => {
    expect(
      parseGoogleAdsSyncRun({
        syncRunId: 'run-1',
        syncRunStartedAt: '2026-08-28T00:00:00.000Z',
      })
    ).toEqual({
      syncRunId: 'run-1',
      syncRunStartedAt: '2026-08-28T00:00:00.000Z',
    });
    expect(parseGoogleAdsSyncRun({ syncRunId: 'run-1' })).toBeNull();
    expect(parseGoogleAdsSyncRun(null)).toBeNull();
  });

  it('reads a provider error and falls back for invalid response bodies', async () => {
    await expect(
      readGoogleAdsError(
        new Response(JSON.stringify({ error: 'provider unavailable' })),
        'fallback'
      )
    ).resolves.toBe('provider unavailable');
    await expect(
      readGoogleAdsError(new Response('not json'), 'fallback')
    ).resolves.toBe('fallback');
    await expect(
      readGoogleAdsError(
        new Response(JSON.stringify({ message: 'other' })),
        'fallback'
      )
    ).resolves.toBe('fallback');
  });
});
