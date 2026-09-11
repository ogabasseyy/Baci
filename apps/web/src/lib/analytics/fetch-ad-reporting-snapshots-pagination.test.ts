import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAdReportingSnapshots,
  GOOGLE_ADS_SPEND_PAGE_SIZE,
  SOCIAL_ADS_SPEND_PAGE_SIZE,
} from './fetch-ad-reporting-snapshots';
import {
  chainResult,
  googleSpendRow,
  socialSpendRow,
} from './fetch-ad-reporting-snapshots.test-support';

function socialConnection() {
  return {
    account_timezone: 'Africa/Lagos',
    last_synced_at: '2026-08-22T09:00:00.000Z',
    provider: 'meta_ads',
    provider_account_label: 'Baci Meta',
    provider_customer_id: 'meta-1',
    status: 'active',
    token_expires_at: '2099-09-01T00:00:00.000Z',
  };
}

describe('fetchAdReportingSnapshots pagination', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('paginates only the selected Google customer before building metrics', async () => {
    const firstPage = Array.from(
      { length: GOOGLE_ADS_SPEND_PAGE_SIZE },
      (_, index) =>
        googleSpendRow({
          spend_date: `2025-01-${String((index % 28) + 1).padStart(2, '0')}`,
        })
    );
    const results = [
      {
        data: {
          last_synced_at: '2026-08-22T09:00:00.000Z',
          provider_customer_id: 'google-1',
          status: 'active',
        },
        error: null,
      },
      { data: [], error: null },
      { data: [], error: null },
      { data: firstPage, error: null },
      { data: [googleSpendRow()], error: null },
    ];
    const terminals = ['maybeSingle', 'in', 'range', 'range', 'range'] as const;
    let index = 0;
    const chains: Record<string, unknown>[] = [];
    const from = vi.fn(() => {
      const chain = chainResult(
        results[index] ?? { data: [], error: null },
        terminals[index++] ?? 'range'
      );
      chains.push(chain);
      return chain;
    });

    const result = await fetchAdReportingSnapshots({
      endDate: '2026-08-22',
      merchantId: 'merchant-1',
      startDate: '2025-01-01',
      supabase: { from } as never,
    });

    expect(result.googleAds?.daily).toHaveLength(
      GOOGLE_ADS_SPEND_PAGE_SIZE + 1
    );
    for (const chain of chains.slice(3)) {
      expect(chain.eq).toHaveBeenCalledWith('provider_customer_id', 'google-1');
    }
  });

  it('paginates social spend rows before building provider metrics', async () => {
    const firstPage = Array.from({ length: SOCIAL_ADS_SPEND_PAGE_SIZE }, () =>
      socialSpendRow()
    );
    const results = [
      { data: null, error: null },
      { data: [socialConnection()], error: null },
      { data: firstPage, error: null },
      {
        data: [socialSpendRow({ clicks: '2', spend_amount_decimal: '2' })],
        error: null,
      },
    ];
    const terminals = ['maybeSingle', 'in', 'range', 'range'] as const;
    let index = 0;
    const from = vi.fn(() =>
      chainResult(
        results[index] ?? { data: [], error: null },
        terminals[index++] ?? 'range'
      )
    );

    const result = await fetchAdReportingSnapshots({
      endDate: '2026-08-22',
      merchantId: 'merchant-1',
      startDate: '2026-08-01',
      supabase: { from } as never,
    });
    const meta = result.socialAds.providers.find(
      (provider) => provider.provider === 'meta_ads'
    );

    expect(meta).toMatchObject({
      connectionStatus: 'connected',
      dataStatus: 'ready',
      metrics: {
        clicks: String(SOCIAL_ADS_SPEND_PAGE_SIZE + 2),
        spendByCurrency: [
          {
            currencyCode: 'NGN',
            spendAmountDecimal: String(SOCIAL_ADS_SPEND_PAGE_SIZE + 2),
          },
        ],
      },
    });
  });

  it('drops partial social spend pages when a later page fails', async () => {
    const firstPage = Array.from({ length: SOCIAL_ADS_SPEND_PAGE_SIZE }, () =>
      socialSpendRow()
    );
    const results = [
      { data: null, error: null },
      { data: [socialConnection()], error: null },
      { data: firstPage, error: null },
      { data: null, error: { message: 'social spend unavailable' } },
    ];
    const terminals = ['maybeSingle', 'in', 'range', 'range'] as const;
    let index = 0;
    const from = vi.fn(() =>
      chainResult(
        results[index] ?? { data: [], error: null },
        terminals[index++] ?? 'range'
      )
    );

    const result = await fetchAdReportingSnapshots({
      endDate: '2026-08-22',
      merchantId: 'merchant-1',
      startDate: '2026-08-01',
      supabase: { from } as never,
    });
    const meta = result.socialAds.providers.find(
      (provider) => provider.provider === 'meta_ads'
    );

    expect(meta).toMatchObject({
      connectionStatus: 'connected',
      dataStatus: 'error',
      metrics: null,
    });
    expect(result.socialAds.spendByCurrency).toEqual([]);
  });
});
