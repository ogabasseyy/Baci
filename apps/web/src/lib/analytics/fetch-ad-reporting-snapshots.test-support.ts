import { vi } from 'vitest';

export function chainResult(
  result: { data: unknown; error: unknown },
  terminal: 'in' | 'maybeSingle' | 'order' | 'range'
) {
  const chain: Record<string, unknown> = {};
  for (const method of ['eq', 'gte', 'in', 'lte', 'order', 'range', 'select']) {
    chain[method] = vi.fn(() =>
      method === terminal ? Promise.resolve(result) : chain
    );
  }
  chain.maybeSingle = () =>
    terminal === 'maybeSingle' ? Promise.resolve(result) : chain;
  return chain;
}

export function socialSpendRow(overrides: Record<string, unknown> = {}) {
  return {
    account_timezone: 'Africa/Lagos',
    clicks: '1',
    conversions: '0',
    currency_code: 'NGN',
    fetched_at: '2026-08-22T09:00:00.000Z',
    impressions: '10',
    provider: 'meta_ads',
    provider_customer_id: 'meta-1',
    reach: null,
    spend_amount_decimal: '1',
    spend_date: '2026-08-22',
    ...overrides,
  };
}

export function googleSpendRow(overrides: Record<string, unknown> = {}) {
  return {
    clicks: '1',
    conversions: '0',
    currency_code: 'NGN',
    fetched_at: '2026-08-22T09:00:00.000Z',
    impressions: '10',
    provider_customer_id: 'google-1',
    spend_date: '2026-08-22',
    spend_micros: '1000000',
    ...overrides,
  };
}
