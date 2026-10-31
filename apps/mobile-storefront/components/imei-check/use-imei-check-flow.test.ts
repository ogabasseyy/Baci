import type { ImeiReport } from '@baci/shared/imei';
import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

let mockUserId = 'user-a';
let mockWalletBalance = 5000;
const mockSecureEntries = new Map<string, string>();
let mockSecureFailure = false;
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockSecureEntries.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    if (mockSecureFailure) throw new Error('storage unavailable');
    mockSecureEntries.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockSecureEntries.delete(key);
  },
}));
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
    data: { wallet: { balance: mockWalletBalance } },
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
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    require('node:crypto').createHash('sha256').update(value).digest('hex'),
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
  mockSecureEntries.clear();
  mockSecureFailure = false;
  jest.clearAllMocks();
  mockUserId = 'user-a';
  mockWalletBalance = 5000;
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
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
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

it('retains an uncertain key when a different check finishes', async () => {
  mockUuid
    .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
    .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
  mockSubmit
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({
      response: { ok: false, status: 402 },
      rawData: { code: 'WALLET_INSUFFICIENT' },
    })
    .mockRejectedValueOnce(new Error('network'));
  const { result } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  await act(async () =>
    result.current.handleVerify('blacklist', report.result.imei, 'smartphone')
  );
  await act(async () =>
    result.current.handleVerify('simLock', report.result.imei, 'smartphone')
  );
  await act(async () =>
    result.current.handleVerify('blacklist', report.result.imei, 'smartphone')
  );
  const keys = mockSubmit.mock.calls.map(
    (call) => (call[0] as { idempotencyKey: string }).idempotencyKey
  );
  expect(keys[0]).toBe(keys[2]);
  expect(keys[0]).not.toBe(keys[1]);
});

it('reuses an uncertain request key after the screen is remounted', async () => {
  mockSubmit.mockRejectedValue(new Error('connection lost'));
  const first = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  await act(async () =>
    first.result.current.handleVerify(
      'blacklist',
      report.result.imei,
      'smartphone'
    )
  );
  first.unmount();
  const restored = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  await act(async () =>
    restored.result.current.handleVerify(
      'blacklist',
      report.result.imei,
      'smartphone'
    )
  );
  expect(
    (mockSubmit.mock.calls[0]?.[0] as { idempotencyKey: string }).idempotencyKey
  ).toBe(
    (mockSubmit.mock.calls[1]?.[0] as { idempotencyKey: string }).idempotencyKey
  );
});

it('does not submit a paid check when its recovery key cannot be saved', async () => {
  mockSecureFailure = true;
  const { result } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  await act(async () =>
    result.current.handleVerify('blacklist', report.result.imei, 'smartphone')
  );
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(result.current.error).toBeTruthy();
});

it('clears a restored recovery key after its pending result completes', async () => {
  const { acquireImeiRecoveryKey } = await import(
    '@/lib/imei-request-recovery'
  );
  const recovery = await acquireImeiRecoveryKey(
    ['merchant:customer:user-a', 'blacklist', report.result.imei],
    mockUuid
  );
  Object.assign(mockPending, {
    terminal: {
      kind: 'complete',
      lookupId: report.lookupId,
      result: report.result,
      tier: 'blacklist',
      device: 'smartphone',
      recovery,
    },
  });
  const { result, unmount } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  await waitFor(() =>
    expect(mockSecureEntries.has(recovery.storageKey)).toBe(false)
  );
  expect(result.current.result).toEqual(report.result);
  Object.assign(mockPending, { terminal: null });
  unmount();
});

it('does not submit a paid check before account identity is available', async () => {
  mockUserId = '';
  const { result } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  await act(async () =>
    result.current.handleVerify('blacklist', report.result.imei, 'smartphone')
  );
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(result.current.error).toBeTruthy();
});

it('allows recovery of an uncertain check even after the wallet balance falls', async () => {
  mockSubmit.mockRejectedValue(new Error('connection lost'));
  const { result, rerender } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  await act(async () =>
    result.current.handleVerify('blacklist', report.result.imei, 'smartphone')
  );
  mockWalletBalance = 0;
  rerender({});
  await act(async () =>
    result.current.handleVerify('blacklist', report.result.imei, 'smartphone')
  );
  expect(mockSubmit).toHaveBeenCalledTimes(2);
  expect(
    (mockSubmit.mock.calls[0]?.[0] as { idempotencyKey: string }).idempotencyKey
  ).toBe(
    (mockSubmit.mock.calls[1]?.[0] as { idempotencyKey: string }).idempotencyKey
  );
});

it('reuses the retry key for differently cased serial numbers', async () => {
  mockSubmit.mockRejectedValue(new Error('connection lost'));
  const { result } = renderHook(() =>
    useImeiCheckFlow('laptop', 'https://test.invalid')
  );
  await act(async () =>
    result.current.handleVerify('serialInfo', 'c02xl0abjgh5', 'laptop')
  );
  await act(async () =>
    result.current.handleVerify('serialInfo', 'C02XL0ABJGH5', 'laptop')
  );
  expect(mockSubmit).toHaveBeenCalledTimes(2);
  expect(
    (mockSubmit.mock.calls[0]?.[0] as { idempotencyKey: string }).idempotencyKey
  ).toBe(
    (mockSubmit.mock.calls[1]?.[0] as { idempotencyKey: string }).idempotencyKey
  );
});

it('requires another explicit check after discovering an earlier report', async () => {
  mockSubmit.mockResolvedValueOnce({
    response: { ok: false, status: 409 },
    rawData: {
      success: false,
      status: 'error',
      code: 'PREVIOUS_REPORT_AVAILABLE',
      error: 'Previous report available',
      lookupId: report.lookupId,
    },
  });
  mockSubmit.mockRejectedValueOnce(new Error('network'));
  const { result } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  await act(async () =>
    result.current.handleVerify('blacklist', report.result.imei, 'smartphone')
  );
  await act(async () =>
    result.current.handleVerify('blacklist', report.result.imei, 'smartphone')
  );
  expect(
    (mockSubmit.mock.calls[0]?.[0] as { previousLookupId?: string })
      .previousLookupId
  ).toBeUndefined();
  expect(
    (mockSubmit.mock.calls[1]?.[0] as { previousLookupId?: string })
      .previousLookupId
  ).toBe(report.lookupId);
  expect(
    (mockSubmit.mock.calls[0]?.[0] as { idempotencyKey: string }).idempotencyKey
  ).toBe(
    (mockSubmit.mock.calls[1]?.[0] as { idempotencyKey: string }).idempotencyKey
  );
});

it('does not authorize a fresh order from an unconfirmed error lookup', async () => {
  mockSubmit.mockResolvedValue({
    response: { ok: false, status: 409 },
    rawData: {
      success: false,
      status: 'error',
      code: 'IDEMPOTENT_REQUEST_IN_FLIGHT',
      error: 'Still processing',
      lookupId: report.lookupId,
    },
  });
  const { result } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  await act(async () =>
    result.current.handleVerify('blacklist', report.result.imei, 'smartphone')
  );
  await act(async () =>
    result.current.handleVerify('blacklist', report.result.imei, 'smartphone')
  );
  expect(
    (mockSubmit.mock.calls[1]?.[0] as { previousLookupId?: string })
      .previousLookupId
  ).toBeUndefined();
});

it.each([
  true,
  false,
])('only clears a recovered failed attempt when refund confirmation is %s', async (confirmedRefund) => {
  const { acquireImeiRecoveryKey } = await import(
    '@/lib/imei-request-recovery'
  );
  const recovery = await acquireImeiRecoveryKey(
    ['merchant:customer:user-a', 'blacklist', report.result.imei],
    mockUuid
  );
  Object.assign(mockPending, {
    terminal: {
      kind: 'error',
      error: 'Check failed',
      tier: 'blacklist',
      recovery,
      confirmedRefund,
    },
  });
  const { result, unmount } = renderHook(() =>
    useImeiCheckFlow('smartphone', 'https://test.invalid')
  );
  await waitFor(() => expect(result.current.error).toBe('Check failed'));
  if (confirmedRefund)
    await waitFor(() =>
      expect(mockSecureEntries.has(recovery.storageKey)).toBe(false)
    );
  else expect(mockSecureEntries.has(recovery.storageKey)).toBe(true);
  Object.assign(mockPending, { terminal: null });
  unmount();
});
