import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Database } from '@/types/supabase';
import { normalizeAdsSpendRow } from './contract';

type SpendRow = Database['public']['Tables']['merchant_ad_spend_daily']['Row'];

describe('ads exact database types', () => {
  it('preserves maximum SQL numeric and bigint values as strings', () => {
    const spendAmountDecimal = '999999999999999999999.999999999';
    const bigint = '9223372036854775807';
    const row: Pick<
      SpendRow,
      | 'clicks'
      | 'conversions'
      | 'impressions'
      | 'reach'
      | 'spend_amount_decimal'
      | 'spend_micros'
    > = {
      clicks: bigint,
      conversions: spendAmountDecimal,
      impressions: bigint,
      reach: bigint,
      spend_amount_decimal: spendAmountDecimal,
      spend_micros: bigint,
    };
    const normalized = normalizeAdsSpendRow({
      accountTimezone: 'UTC',
      attributionMetadata: {},
      clicks: row.clicks,
      conversions: row.conversions,
      currencyCode: 'USD',
      fetchedAt: '2026-08-21T10:00:00.000Z',
      impressions: row.impressions,
      provider: 'meta_ads',
      providerCustomerId: 'act_1',
      reach: row.reach ?? undefined,
      spendAmountDecimal: row.spend_amount_decimal ?? '',
      spendDate: '2026-08-21',
      spendMicros: row.spend_micros,
    });

    expect(normalized).toMatchObject({
      conversions: spendAmountDecimal,
      spendAmountDecimal,
      spendMicros: bigint,
    });
    expectTypeOf<SpendRow['spend_amount_decimal']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<SpendRow['spend_micros']>().toEqualTypeOf<string>();
  });
});
