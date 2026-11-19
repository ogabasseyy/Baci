import { renderHook } from '@testing-library/react-native';
import { usePiggyvestAccountUnconfirmed } from './use-piggyvest-account-unconfirmed';

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
let mockVerdict: boolean | null = null;
let mockMerchantId: string | null = PILOT;
let mockRuledOut = false;

jest.mock('@/hooks/use-piggyvest-capability-now', () => ({
  usePiggyvestCapabilityNow: () => mockVerdict,
}));
jest.mock('@/lib/piggyvest-primary-capability-cache', () => ({
  readObservedPiggyvestPrimaryCapability: () => null,
  wasPiggyvestLastRuledOut: () => mockRuledOut,
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: { merchantId: string | null }) => unknown) =>
    select({ merchantId: mockMerchantId }),
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: '' } }));

beforeEach(() => {
  mockVerdict = null;
  mockMerchantId = PILOT;
  mockRuledOut = false;
});

describe('usePiggyvestAccountUnconfirmed with the server keeping PiggyVest off', () => {
  it('is false once the server rules PiggyVest out', () => {
    mockVerdict = false;
    const { result } = renderHook(() =>
      usePiggyvestAccountUnconfirmed('piggyvest')
    );
    expect(result.current).toBe(false);
  });

  it('is false for a legacy account or another store', () => {
    expect(
      renderHook(() => usePiggyvestAccountUnconfirmed('paystack')).result
        .current
    ).toBe(false);
    mockMerchantId = 'other-merchant';
    expect(
      renderHook(() => usePiggyvestAccountUnconfirmed('piggyvest')).result
        .current
    ).toBe(false);
  });

  it('stays false after a rollback whose ruling-out just expired', () => {
    mockRuledOut = true;
    const { result } = renderHook(() =>
      usePiggyvestAccountUnconfirmed('piggyvest')
    );
    expect(result.current).toBe(false);
  });
});

describe('bugfix: cold launch with the server down hid the saved account (walk 14)', () => {
  it('is true for a saved PiggyVest account while the status is unknown', () => {
    const { result } = renderHook(() =>
      usePiggyvestAccountUnconfirmed('piggyvest')
    );
    expect(result.current).toBe(true);
  });
});
