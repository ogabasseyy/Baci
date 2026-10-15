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
}));
jest.mock('@/lib/query-client', () => ({
  queryClient: { getQueryData: jest.fn() },
}));

import { queryClient } from '@/lib/query-client';
import { resolveNativeAddedLineAssurance } from './cart-assurance-default';

const getQueryData = queryClient.getQueryData as jest.Mock;

describe('resolveNativeAddedLineAssurance', () => {
  beforeEach(() => {
    mockConfig.merchantSlug = 'ogabassey';
    mockConfig.smartCartProEnabled = true;
    getQueryData.mockReset();
    getQueryData.mockReturnValue({ shipping_insurance_enabled: true });
  });

  it('defaults Ogabassey lines on when insurance is affirmatively enabled', () => {
    expect(resolveNativeAddedLineAssurance({})).toBe(true);
  });

  it('stays opt-out when the insurance setting is unknown', () => {
    getQueryData.mockReturnValue(undefined);
    expect(resolveNativeAddedLineAssurance({})).toBe(false);
  });

  it('stays opt-out when insurance is disabled', () => {
    getQueryData.mockReturnValue({ shipping_insurance_enabled: false });
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
