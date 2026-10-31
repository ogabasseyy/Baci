import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingImeiStorageKey } from './imei-pending-storage';
import { useImeiCheckRequest } from './use-imei-check-request';

Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, fn: () => unknown) => fn() } });

const mocks = vi.hoisted(() => ({ check: vi.fn(), poll: vi.fn(), signedIn: true }));
vi.mock('./imei-checker-request', () => ({
  performImeiCheck: mocks.check,
  pollImeiCheck: mocks.poll,
}));
vi.mock('@/contexts/customer-auth-context', () => ({
  useOptionalCustomerAuth: () => mocks.signedIn ? ({ customer: { id: 'hook-customer' }, user: { id: 'hook-user' }, isLoading: false }) : ({ customer: null, user: null, isLoading: false }),
}));

const lookupId = '11111111-1111-4111-8111-111111111111';
const report = {
  imei: '354442067957452',
  device: 'iPhone',
  blacklistStatus: 'Unknown',
};
const key = () =>
  pendingImeiStorageKey(window.location.host, 'hook-customer', 'ogabassey');
const outcome = {
  result: null,
  lookupId: null,
  error: null,
  keepRequestIdentity: false,
  needsSignIn: false,
  needsWalletFunding: false,
  pending: null,
};

describe('useImeiCheckRequest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    localStorage.clear();
    mocks.signedIn = true;
    mocks.check.mockReset();
    mocks.poll
      .mockReset()
      .mockResolvedValue({ kind: 'complete', lookupId, result: report });
  });

  it('finishes an accepted paid check in memory when saving recovery data throws', async () => {
    let finishPoll:
      | ((value: {
          kind: 'complete';
          lookupId: string;
          result: typeof report;
        }) => void)
      | undefined;
    mocks.poll.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPoll = resolve;
        })
    );
    mocks.check.mockResolvedValue({
      ...outcome,
      pending: { lookupId, pollAfterMs: 0 },
      keepRequestIdentity: true,
    });
    const { result } = renderHook(() => useImeiCheckRequest('ogabassey'));
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith('baci:imei-pending:')) throw new DOMException('quota', 'QuotaExceededError');
      return originalSetItem.call(this, key, value);
    });
    await act(async () => {
      await expect(
        result.current.runCheck('simLock', report.imei, 'smartphone')
      ).resolves.toBeUndefined();
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.pendingLookup.pending).not.toBeNull();
    expect(result.current.pendingLookup.canResume).toBe(false);
    await act(async () => {
      await result.current.runCheck('simLock', report.imei, 'smartphone');
    });
    expect(mocks.check).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(mocks.poll).toHaveBeenCalledWith(lookupId, 'ogabassey')
    );
    await act(async () => {
      finishPoll?.({ kind: 'complete', lookupId, result: report });
    });
    await waitFor(() => expect(result.current.result).toEqual(report));
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.poll).toHaveBeenCalledWith(lookupId, 'ogabassey');
  });

  it('releases the latch after an unexpected rejection and retries explicitly with the same identity', async () => {
    mocks.check.mockResolvedValue({ ...outcome, result: report, lookupId });
    const { result } = renderHook(() => useImeiCheckRequest('ogabassey'));
    await act(async () => {
      await result.current.runCheck('simLock', report.imei, 'smartphone');
    });
    mocks.check.mockRejectedValueOnce(new Error('unexpected'));
    await act(async () => {
      await expect(
        result.current.runCheck('blacklist', report.imei, 'smartphone', true)
      ).resolves.toBeUndefined();
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toMatch(/network error/i);
    expect(result.current.result).toEqual(report);
    await act(async () => {
      await result.current.runCheck(
        'blacklist',
        report.imei,
        'smartphone',
        true
      );
    });
    expect(mocks.check).toHaveBeenCalledTimes(3);
    expect(mocks.check.mock.calls[2][3]).toBe(mocks.check.mock.calls[1][3]);
  });

  it.each([
    ['simLock', undefined, 'smartphone'],
    ['appleBasic', 'smartphone', 'smartphone'],
    ['appleBasic', 'tablet', 'tablet'],
    ['appleBasic', undefined, null],
  ])('restores %s report device %s as %s without another purchase', async (tier, device, expected) => {
    localStorage.setItem(
      key(),
      JSON.stringify({
        createdAt: new Date().toISOString(),
        lookupId,
        tier,
        device,
      })
    );
    const { result } = renderHook(() => useImeiCheckRequest('ogabassey'));
    await waitFor(() => expect(result.current.result).toEqual(report));
    expect(result.current.resultDevice).toBe(expected);
    expect(result.current.resultLookupId).toBe(lookupId);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it('persists the selected device before resuming a multi-device tier', async () => {
    mocks.check.mockResolvedValue({
      ...outcome,
      pending: { lookupId, pollAfterMs: 60_000 },
      keepRequestIdentity: true,
    });
    const first = renderHook(() => useImeiCheckRequest('ogabassey'));
    await act(async () => {
      await first.result.current.runCheck('appleBasic', report.imei, 'tablet');
    });
    expect(JSON.parse(localStorage.getItem(key()) ?? '{}')).toMatchObject({
      device: 'tablet',
      tier: 'appleBasic',
    });
    first.unmount();
    const restored = renderHook(() => useImeiCheckRequest('ogabassey'));
    await waitFor(() =>
      expect(restored.result.current.resultDevice).toBe('tablet')
    );
    expect(mocks.check).toHaveBeenCalledOnce();
  });

  it('exposes wallet errors while preserving the original report for a follow-up', async () => {
    mocks.check.mockResolvedValue({ ...outcome, result: report, lookupId });
    const { result } = renderHook(() => useImeiCheckRequest('ogabassey'));
    await act(async () => {
      await result.current.runCheck('simLock', report.imei, 'smartphone');
    });
    mocks.check.mockResolvedValue({
      ...outcome,
      error: 'Insufficient wallet balance',
      needsWalletFunding: true,
    });
    await act(async () => {
      await result.current.runCheck(
        'blacklist',
        report.imei,
        'smartphone',
        true
      );
    });
    expect(result.current.result).toEqual(report);
    expect(result.current.resultTier?.name).toBe('SIM Lock');
    expect(result.current.error).toBe('Insufficient wallet balance');
    expect(result.current.needsWalletFunding).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });
});

it('retains an uncertain retry key when a different check completes', async () => {
  localStorage.clear();
  mocks.check.mockReset();
  mocks.check
    .mockResolvedValueOnce({ ...outcome, error: 'Network error', keepRequestIdentity: true })
    .mockResolvedValueOnce({ ...outcome, result: report, lookupId })
    .mockResolvedValueOnce({ ...outcome, error: 'Network error', keepRequestIdentity: true });
  const { result } = renderHook(() => useImeiCheckRequest('ogabassey'));
  await act(async () => result.current.runCheck('blacklist', report.imei, 'smartphone'));
  await act(async () => result.current.runCheck('simLock', report.imei, 'smartphone'));
  await act(async () => result.current.runCheck('blacklist', report.imei, 'smartphone'));
  expect(mocks.check.mock.calls[0]?.[3]).toBe(mocks.check.mock.calls[2]?.[3]);
  expect(mocks.check.mock.calls[0]?.[3]).not.toBe(mocks.check.mock.calls[1]?.[3]);
});

it('reuses an uncertain request key after the screen is remounted', async () => {
  localStorage.clear();
  mocks.check.mockReset().mockResolvedValue({ ...outcome, error: 'Network error', keepRequestIdentity: true });
  const first = renderHook(() => useImeiCheckRequest('ogabassey'));
  await act(async () => first.result.current.runCheck('blacklist', report.imei, 'smartphone'));
  first.unmount();
  const restored = renderHook(() => useImeiCheckRequest('ogabassey'));
  await act(async () => restored.result.current.runCheck('blacklist', report.imei, 'smartphone'));
  expect(mocks.check.mock.calls[0]?.[3]).toBe(mocks.check.mock.calls[1]?.[3]);
});

it('does not submit a paid check when its recovery key cannot be saved', async () => {
  localStorage.clear();
  mocks.check.mockReset();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
  const { result } = renderHook(() => useImeiCheckRequest('ogabassey'));
  await act(async () => result.current.runCheck('blacklist', report.imei, 'smartphone'));
  expect(mocks.check).not.toHaveBeenCalled();
  expect(result.current.error).toBeTruthy();
  vi.restoreAllMocks();
});

it('clears the saved retry key when a restored pending check completes', async () => {
  localStorage.clear();
  mocks.check.mockReset().mockResolvedValue({ ...outcome, pending: { lookupId, pollAfterMs: 60000 }, keepRequestIdentity: true });
  const first = renderHook(() => useImeiCheckRequest('ogabassey'));
  await act(async () => first.result.current.runCheck('blacklist', report.imei, 'smartphone'));
  const recovery = JSON.parse(localStorage.getItem(key()) ?? '{}').recovery;
  expect(localStorage.getItem(recovery.storageKey)).toBe(recovery.idempotencyKey);
  first.unmount();
  mocks.poll.mockResolvedValue({ kind: 'complete', lookupId, result: report });
  renderHook(() => useImeiCheckRequest('ogabassey'));
  await waitFor(() => expect(localStorage.getItem(recovery.storageKey)).toBeNull());
});


it('does not submit before a stable customer identity is available', async () => {
  mocks.signedIn = false;
  mocks.check.mockReset();
  const { result } = renderHook(() => useImeiCheckRequest('ogabassey'));
  await act(async () => result.current.runCheck('blacklist', report.imei, 'smartphone'));
  expect(mocks.check).not.toHaveBeenCalled();
  expect(result.current.needsSignIn).toBe(true);
  mocks.signedIn = true;
});


it('reuses the retry key for differently cased serial numbers', async () => {
  localStorage.clear();
  mocks.check.mockReset().mockResolvedValue({ ...outcome, error: 'Network error', keepRequestIdentity: true });
  const { result } = renderHook(() => useImeiCheckRequest('ogabassey'));
  await act(async () => result.current.runCheck('serialInfo', 'c02xl0abjgh5', 'laptop'));
  await act(async () => result.current.runCheck('serialInfo', 'C02XL0ABJGH5', 'laptop'));
  expect(mocks.check).toHaveBeenCalledTimes(2);
  expect(mocks.check.mock.calls[0]?.[3]).toBe(mocks.check.mock.calls[1]?.[3]);
});

it('requires an explicit second check after discovering an earlier report', async () => {
  localStorage.clear();
  mocks.check.mockReset()
    .mockResolvedValueOnce({ ...outcome, error: 'Previous report available', lookupId, keepRequestIdentity: true, previousReportAvailable: true })
    .mockResolvedValueOnce({ ...outcome, result: report, lookupId });
  const { result } = renderHook(() => useImeiCheckRequest('ogabassey'));
  await act(async () => result.current.runCheck('blacklist', report.imei, 'smartphone'));
  expect(mocks.check.mock.calls[0]?.[7]).toBeUndefined();
  await act(async () => result.current.runCheck('blacklist', report.imei, 'smartphone'));
  expect(mocks.check.mock.calls[1]?.[7]).toBe(lookupId);
  expect(mocks.check.mock.calls[0]?.[3]).toBe(mocks.check.mock.calls[1]?.[3]);
});

it('does not authorize a fresh order from an unconfirmed error lookup', async () => {
  localStorage.clear();
  mocks.check.mockReset().mockResolvedValue({ ...outcome, error: 'Still processing', lookupId, keepRequestIdentity: true });
  const { result } = renderHook(() => useImeiCheckRequest('ogabassey'));
  await act(async () => result.current.runCheck('blacklist', report.imei, 'smartphone'));
  await act(async () => result.current.runCheck('blacklist', report.imei, 'smartphone'));
  expect(mocks.check.mock.calls[1]?.[7]).toBeUndefined();
});

it.each([true, false])('only clears a polled failed attempt when refund confirmation is %s', async (confirmedRefund) => {
  localStorage.clear();
  mocks.signedIn = true;
  mocks.check.mockReset().mockResolvedValue({ ...outcome, pending: { lookupId, pollAfterMs: 0 }, keepRequestIdentity: true });
  mocks.poll.mockReset().mockResolvedValue({ kind: 'error', error: 'Check failed', confirmedRefund });
  const { result, unmount } = renderHook(() => useImeiCheckRequest('ogabassey'));
  await act(async () => { await result.current.runCheck('simLock', report.imei, 'smartphone'); });
  await waitFor(() => expect(result.current.error).toBe('Check failed'));
  const attempts = () => Object.keys(localStorage).filter((item) => item.startsWith('baci:imei-attempt:v1:'));
  if (confirmedRefund) await waitFor(() => expect(attempts()).toHaveLength(0));
  else expect(attempts()).toHaveLength(1);
  unmount();
});
