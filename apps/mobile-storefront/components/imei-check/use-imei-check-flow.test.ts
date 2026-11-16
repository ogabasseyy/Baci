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
it('reopens a completed report without checkout or provider submission', () => {
  const { result } = renderHook(() =>
    useImeiCheckFlow('tablet', 'https://test.invalid')
  );
  act(() => result.current.openReport(report, listedFor()));
  expect(result.current.result).toEqual(report.result);
  expect(result.current.resultDevice).toBe('smartphone');
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(mockPending.start).not.toHaveBeenCalled();
});
it('preserves the reopened report on follow-up error and uses report device rather than picker', async () => {
  mockSubmit.mockResolvedValue({
    response: { ok: false, status: 502 },
    rawData: { error: 'Supplier unavailable' },
  });
  const { result } = renderHook(() =>
    useImeiCheckFlow('tablet', 'https://test.invalid')
  );
  act(() => result.current.openReport(report, listedFor()));
  await act(async () => {
    await result.current.handleVerify(
      'blacklist',
      report.result.imei,
      'smartphone',
      true
    );
  });
  expect(mockSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      tier: 'blacklist',
      identifier: report.result.imei,
      device: 'smartphone',
    })
  );
  expect(result.current.result).toEqual(report.result);
  expect(result.current.error).toBeTruthy();
  expect(result.current.isLoading).toBe(false);
});
it('blocks double taps while keeping the original report visible', async () => {
  let resolve!: (value: unknown) => void;
  mockSubmit.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { result } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  act(() => result.current.openReport(report, listedFor()));
  let first!: Promise<void>;
  act(() => {
    first = result.current.handleVerify(
      'blacklist',
      report.result.imei,
      'smartphone',
      true
    );
    void result.current.handleVerify(
      'blacklist',
      report.result.imei,
      'smartphone',
      true
    );
  });
  // The rail decision awaits the saved PiggyVest keys before submitting.
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockSubmit).toHaveBeenCalledTimes(1);
  expect(result.current.result).toEqual(report.result);
  await act(async () => {
    resolve({
      response: { ok: true },
      rawData: {
        success: true,
        status: 'complete',
        lookupId: report.lookupId,
        data: { ...report.result, blacklistStatus: 'Clean' },
      },
    });
    await first;
  });
  expect(result.current.result?.blacklistStatus).toBe('Clean');
  expect(result.current.isLoading).toBe(false);
});

it.each([
  'timeout',
  'invalid response',
])('keeps an uncertain submission identity across returning to the form (%s)', async (failure) => {
  mockUuid
    .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
    .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
  if (failure === 'timeout')
    mockSubmit.mockRejectedValueOnce(new Error('timeout'));
  else
    mockSubmit.mockResolvedValueOnce({
      response: { ok: true },
      rawData: { success: true },
    });
  mockSubmit.mockResolvedValueOnce({
    response: { ok: true },
    rawData: {
      success: true,
      status: 'complete',
      lookupId: report.lookupId,
      data: report.result,
    },
  });
  const { result } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  await act(async () => {
    await result.current.handleVerify('blacklist', report.result.imei);
  });
  act(() => result.current.handleReset());
  await act(async () => {
    await result.current.handleVerify('blacklist', report.result.imei);
  });
  expect(mockUuid).toHaveBeenCalledTimes(1);
  expect(mockSubmit.mock.calls[1]?.[0]).toEqual(
    expect.objectContaining({
      idempotencyKey: (
        mockSubmit.mock.calls[0]?.[0] as { idempotencyKey: string }
      ).idempotencyKey,
    })
  );
});

it('reopening a saved report does not discard an uncertain paid follow-up key', async () => {
  mockUuid
    .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
    .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
  mockSubmit.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
    response: { ok: true },
    rawData: {
      success: true,
      status: 'complete',
      lookupId: report.lookupId,
      data: report.result,
    },
  });
  const { result } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  act(() => result.current.openReport(report, listedFor()));
  await act(async () => {
    await result.current.handleVerify(
      'blacklist',
      report.result.imei,
      'smartphone',
      true
    );
  });
  act(() => result.current.openReport(report, listedFor()));
  await act(async () => {
    await result.current.handleVerify(
      'blacklist',
      report.result.imei,
      'smartphone',
      true
    );
  });
  expect(mockUuid).toHaveBeenCalledTimes(1);
});

it('pays a reopened report follow-up from PiggyVest when store credit cannot cover it', async () => {
  mockBalance = 0;
  mockPiggyvestCovers = true;
  const { result } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  act(() => result.current.openReport(report, listedFor()));
  await act(async () => {
    await result.current.handleVerify(
      'blacklist',
      report.result.imei,
      'smartphone',
      true
    );
  });
  expect(mockWalletPayOpen).toHaveBeenCalledWith(
    'blacklist',
    report.result.imei
  );
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(result.current.result).toEqual(report.result);
});

it('shows an invalid number inline and drops it once the number is edited', async () => {
  const { result } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  await act(async () => {
    await result.current.handleVerify('blacklist', '123');
  });
  expect(result.current.error).toBe(
    'Please enter a valid 15-digit IMEI number.'
  );
  expect(mockSubmit).not.toHaveBeenCalled();
  act(() => result.current.dropInvalidIdentifierError());
  expect(result.current.error).toBeNull();
});
