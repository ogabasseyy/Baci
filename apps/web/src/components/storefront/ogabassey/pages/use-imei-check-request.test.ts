import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingImeiStorageKey } from './imei-pending-storage';
import { useImeiCheckRequest } from './use-imei-check-request';

const mocks = vi.hoisted(() => ({ check: vi.fn(), poll: vi.fn() }));
vi.mock('./imei-checker-request', () => ({
  performImeiCheck: mocks.check,
  pollImeiCheck: mocks.poll,
}));
vi.mock('@/contexts/customer-auth-context', () => ({
  useOptionalCustomerAuth: () => ({ customer: { id: 'hook-customer' } }),
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
  beforeEach(() => {
    localStorage.clear();
    mocks.check.mockReset();
    mocks.poll
      .mockReset()
      .mockResolvedValue({ kind: 'complete', lookupId, result: report });
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
