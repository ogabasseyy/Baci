import { describe, expect, it } from 'vitest';
import {
  parseMetaAdsAccount,
  parseMetaAdsDailyInsights,
} from './provider-parser';

describe('Meta Ads provider parser', () => {
  it('rejects malformed accounts before they reach reporting code', () => {
    expect(parseMetaAdsAccount({ id: 'not-an-account' })).toBeNull();
  });

  it('normalizes a valid account to the canonical act_ id', () => {
    expect(
      parseMetaAdsAccount({
        account_status: 1,
        currency: 'NGN',
        id: 'act_123',
        name: 'Baci',
        timezone_name: 'Africa/Lagos',
      })
    ).toEqual({
      accountId: 'act_123',
      currencyCode: 'NGN',
      label: 'Baci',
      timezoneName: 'Africa/Lagos',
      timezoneOffsetHours: null,
    });
  });

  it('excludes disabled accounts from merchant account selection', () => {
    expect(
      parseMetaAdsAccount({
        account_status: 2,
        currency: 'NGN',
        id: 'act_123',
        name: 'Disabled account',
        timezone_name: 'Africa/Lagos',
      })
    ).toBeNull();
  });

  it('rejects a page when any insight row is malformed instead of dropping it', () => {
    expect(() =>
      parseMetaAdsDailyInsights(
        {
          data: [
            {
              account_id: '123',
              clicks: '2',
              date_start: '2026-08-20',
              date_stop: '2026-08-20',
              impressions: '10',
              spend: '3.10',
            },
            {
              account_id: '123',
              clicks: 'not-a-number',
              date_start: '2026-08-21',
              date_stop: '2026-08-21',
              impressions: '11',
              spend: '4.20',
            },
          ],
        },
        'act_123'
      )
    ).toThrowError(
      expect.objectContaining({ code: 'META_ADS_INSIGHTS_ROW_INVALID' })
    );
  });

  it('rejects malformed action entries instead of persisting a partial row', () => {
    expect(() =>
      parseMetaAdsDailyInsights(
        {
          data: [
            {
              account_id: '123',
              actions: [{ action_type: 'purchase', value: 'invalid' }],
              clicks: '2',
              date_start: '2026-08-20',
              date_stop: '2026-08-20',
              impressions: '10',
              spend: '3.10',
            },
          ],
        },
        'act_123'
      )
    ).toThrowError(
      expect.objectContaining({ code: 'META_ADS_INSIGHTS_ROW_INVALID' })
    );
  });
});
