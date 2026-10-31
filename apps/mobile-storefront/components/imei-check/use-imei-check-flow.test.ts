import type { ImeiReport } from '@baci/shared/imei';
import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

let mockUserId = 'user-a';
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
    data: { wallet: { balance: 5000 } },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (value: unknown) => unknown) =>
    select({
      session: { access_token: 'test-token', user: { id: mockUserId } },
      customer: { id: 'customer' },
      merchantId: 'merchant',
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

const report: ImeiReport = {
  lookupId: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-10-31T00:00:00Z',
  tier: 'simLock',
  device: 'smartphone',
  result: {
    imei: '490154203237518',
    device: 'iPhone 13',
    modelNumber: '',
    status: 'Unknown',
    icloud: 'Unknown',
    icloudLock: 'Unknown',
    simLock: 'Unlocked',
    blacklistStatus: 'Unknown',
    carrier: 'Unknown',
    deviceImage: '',
    score: 50,
    deviceType: 'apple',
    verdict: 'Not checked',
    verdictType: 'caution',
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'user-a';
  mockUuid.mockReset().mockReturnValue('11111111-1111-4111-8111-111111111111');
});
it('reopens a completed report without checkout or provider submission', () => {
  const { result } = renderHook(() =>
    useImeiCheckFlow('tablet', 'https://test.invalid')
  );
  act(() => result.current.openReport(report));
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
  act(() => result.current.openReport(report));
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
it('blocks double taps synchronously while keeping the original report visible', async () => {
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
  act(() => result.current.openReport(report));
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
  act(() => result.current.openReport(report));
  mockUserId = 'user-b';
  rerender({});
  expect(result.current.result).toBeNull();
  act(() => result.current.openReport(report));
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
  act(() => result.current.openReport(report));
  await act(async () => {
    await result.current.handleVerify(
      'blacklist',
      report.result.imei,
      'smartphone',
      true
    );
  });
  act(() => result.current.openReport(report));
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
