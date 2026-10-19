import { jest } from '@jest/globals';

const mockConfig: { merchantSlug: string; smartCartProEnabled: boolean } = {
  merchantSlug: 'ogabassey',
  smartCartProEnabled: true,
};
jest.mock('@/lib/config', () => ({
  CONFIG: {
    get MERCHANT_SLUG() {
      return mockConfig.merchantSlug;
    },
    get ENABLE_SMART_CART_PRO() {
      return mockConfig.smartCartProEnabled;
    },
  },
}));

jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  merchantPaymentSettingsQueryKey: ['test-payment-settings'],
  MERCHANT_PAYMENT_SETTINGS_STALE_MS: 5 * 60 * 1000,
}));
jest.mock('@/lib/query-client', () => ({
  queryClient: { getQueryState: jest.fn() },
}));

import { queryClient } from '@/lib/query-client';
import { resolveNativeAddedLineAssurance } from './cart-assurance-default';

const getQueryState = (queryClient as { getQueryState: unknown })
  .getQueryState as jest.Mock;

describe('resolveNativeAddedLineAssurance', () => {
  beforeEach(() => {
    mockConfig.merchantSlug = 'ogabassey';
    mockConfig.smartCartProEnabled = true;
    getQueryState.mockReset();
    getQueryState.mockReturnValue({
      data: { shipping_insurance_enabled: true },
      dataUpdatedAt: Date.now(),
    });
  });

  it('defaults Ogabassey lines on when insurance is affirmatively enabled', () => {
    expect(resolveNativeAddedLineAssurance({})).toBe(true);
  });

  it('stays opt-out when the insurance setting is unknown', () => {
    getQueryState.mockReturnValue(undefined);
    expect(resolveNativeAddedLineAssurance({})).toBe(false);
  });

  it('stays opt-out when a stale restore claims insurance is enabled', () => {
    getQueryState.mockReturnValue({
      data: { shipping_insurance_enabled: true },
      dataUpdatedAt: Date.now() - 24 * 60 * 60 * 1000,
    });
    expect(resolveNativeAddedLineAssurance({})).toBe(false);
  });

  it('stays opt-out when insurance is disabled', () => {
    getQueryState.mockReturnValue({
      data: { shipping_insurance_enabled: false },
      dataUpdatedAt: Date.now(),
    });
    expect(resolveNativeAddedLineAssurance({})).toBe(false);
  });

  it('stays opt-in for other merchants', () => {
    mockConfig.merchantSlug = 'another-store';
    expect(resolveNativeAddedLineAssurance({})).toBe(false);
  });

  it('stays opt-in when Smart Cart Pro is disabled', () => {
    mockConfig.smartCartProEnabled = false;
    expect(resolveNativeAddedLineAssurance({})).toBe(false);
  });

  it('lets an explicit choice win over the default', () => {
    expect(resolveNativeAddedLineAssurance({ hasAssurance: false })).toBe(
      false
    );
    mockConfig.merchantSlug = 'another-store';
    expect(resolveNativeAddedLineAssurance({ hasAssurance: true })).toBe(true);
  });

  it.each([
    { label: 'award id only', line: { voucher_award_id: 'award-1' } },
    { label: 'token only', line: { voucher_token: 'token-1' } },
    {
      label: 'both identifiers',
      line: { voucher_award_id: 'award-1', voucher_token: 'token-1' },
    },
  ])('forces voucher lines ($label) to opt out', ({ line }) => {
    expect(resolveNativeAddedLineAssurance(line)).toBe(false);
  });

  it('lets an explicit choice win on voucher lines', () => {
    expect(
      resolveNativeAddedLineAssurance({
        hasAssurance: true,
        voucher_award_id: 'award-1',
      })
    ).toBe(true);
  });
});
