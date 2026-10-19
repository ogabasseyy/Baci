import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearCustomerAuthRollbackPending,
  getRememberedCustomerUserId,
  isCustomerAuthRollbackPending,
  markCustomerAuthRollbackPending,
  resetRememberedCustomerSessionsForTests,
  rollbackCustomerAuthSession,
  setRememberedCustomerUserId,
} from './customer-auth-storage';

describe('customer-auth-storage', () => {
  afterEach(() => {
    resetRememberedCustomerSessionsForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('persists and clears remembered customer user IDs per merchant', () => {
    setRememberedCustomerUserId('ogabassey', 'user-1');
    expect(getRememberedCustomerUserId('ogabassey')).toBe('user-1');

    setRememberedCustomerUserId('ogabassey', null);
    expect(getRememberedCustomerUserId('ogabassey')).toBeNull();
  });

  it('keeps rollback pending when logout returns a non-OK status or throws, and clears on 200', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(rollbackCustomerAuthSession('ogabassey')).resolves.toBe(false);
    expect(isCustomerAuthRollbackPending('ogabassey')).toBe(true);

    await expect(rollbackCustomerAuthSession('ogabassey')).resolves.toBe(false);
    expect(isCustomerAuthRollbackPending('ogabassey')).toBe(true);

    await expect(rollbackCustomerAuthSession('ogabassey')).resolves.toBe(true);
    expect(isCustomerAuthRollbackPending('ogabassey')).toBe(false);

    markCustomerAuthRollbackPending('ogabassey');
    expect(isCustomerAuthRollbackPending('ogabassey')).toBe(true);
    clearCustomerAuthRollbackPending('ogabassey');
    expect(isCustomerAuthRollbackPending('ogabassey')).toBe(false);
  });
});
