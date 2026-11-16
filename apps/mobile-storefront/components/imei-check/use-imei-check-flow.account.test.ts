import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

let mockUserId = 'user-a';
let mockBalance = 5000;
let mockPiggyvestCovers = false;
const mockWalletPayOpen = jest.fn();
const mockUuid = jest.fn(() => '11111111-1111-4111-8111-111111111111');
const mockSubmit = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockPending = {
  pending: null,
  terminal: null,
  paused: false,
  start: jest.fn(),
  clear: jest.fn(),
  clearTerminal: jest.fn(),
};
jest.mock('./submit-imei-check', () => ({
  submitImeiCheck: (...args: unknown[]) => mockSubmit(...args),
}));
jest.mock('./use-imei-pending-lookup', () => ({
  useImeiPendingLookup: () => mockPending,
}));
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: { wallet: { balance: mockBalance } },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/stores/auth-store', () => {
  const state = () => ({
    session: { access_token: 'test-token', user: { id: mockUserId } },
    user: { id: mockUserId },
    customer: { id: 'customer' },
    merchantId: 'merchant',
  });
  return {
    useAuthStore: Object.assign(
      (select: (value: unknown) => unknown) => select(state()),
      { getState: state }
    ),
  };
});
// PiggyVest pay is switched off here: these checks pay from store credit.
jest.mock('./use-imei-wallet-pay', () => ({
  useImeiWalletPay: () => ({
    sheet: { step: 'closed', back: jest.fn(), close: jest.fn() },
    sheetProps: {},
    view: { covers: () => mockPiggyvestCovers, savingsKobo: null },
    waitsForWallet: false,
    covers: () => mockPiggyvestCovers,
    retains: async () => false,
    open: (...args: unknown[]) => mockWalletPayOpen(...args),
  }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => mockUuid(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn() }),
}));

import { useImeiCheckFlow } from './use-imei-check-flow';
import { report } from './use-imei-check-flow.test-fixture';

const listedFor = () => `merchant:customer:${mockUserId}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'user-a';
  mockBalance = 5000;
  mockPiggyvestCovers = false;
  mockUuid.mockReset().mockReturnValue('11111111-1111-4111-8111-111111111111');
});

it('accepts a new follow-up after the authenticated user changes', async () => {
  mockSubmit.mockResolvedValue({
    response: { ok: true },
    rawData: {
      success: true,
      status: 'complete',
      lookupId: report.lookupId,
      data: { ...report.result, blacklistStatus: 'Clean' },
    },
  });
  const { result, rerender } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  act(() => result.current.openReport(report, listedFor()));
  mockUserId = 'user-b';
  rerender({});
  expect(result.current.result).toBeNull();
  act(() => result.current.openReport(report, listedFor()));
  await act(async () => {
    await result.current.handleVerify(
      'blacklist',
      report.result.imei,
      'smartphone',
      true
    );
  });
  expect(result.current.result?.blacklistStatus).toBe('Clean');
});

it('hides the shown report device and lookup as soon as the account changes', () => {
  const { result, rerender } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  act(() => result.current.openReport(report, listedFor()));
  expect(result.current.resultDevice).toBe('smartphone');
  mockUserId = 'user-b';
  rerender({});
  expect(result.current.result).toBeNull();
  expect(result.current.resultDevice).toBeNull();
  expect(result.current.resultLookupId).toBeNull();
});

it('does not show a report listed for the account that just signed out', () => {
  const { result, rerender } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  const listedForA = listedFor();
  mockUserId = 'user-b';
  rerender({});
  act(() => result.current.openReport(report, listedForA));
  expect(result.current.result).toBeNull();
});
