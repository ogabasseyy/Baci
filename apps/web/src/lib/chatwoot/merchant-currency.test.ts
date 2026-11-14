import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ from: mocks.from }),
}));

import { loadChatwootMerchantCurrency } from './merchant-currency';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
  mocks.maybeSingle.mockResolvedValue({
    data: { country: 'NG', payout_currency: 'ngn' },
    error: null,
  });
});

describe('loadChatwootMerchantCurrency', () => {
  it('resolves only the current public currency fields for the bound merchant', async () => {
    await expect(loadChatwootMerchantCurrency('merchant-1')).resolves.toEqual({
      country: 'NG',
      currency: 'NGN',
    });
    expect(mocks.from).toHaveBeenCalledWith('merchants');
    expect(mocks.select).toHaveBeenCalledWith('country, payout_currency');
    expect(mocks.eq).toHaveBeenCalledWith('id', 'merchant-1');
  });

  it('fails closed on query errors and missing merchants', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error() });
    await expect(
      loadChatwootMerchantCurrency('merchant-1')
    ).resolves.toBeNull();

    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      loadChatwootMerchantCurrency('merchant-1')
    ).resolves.toBeNull();
  });
});
