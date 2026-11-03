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
import { subscribeCustomerIdentityChange } from './customer-live-identity';

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

  it('invalidates account views before and after an ambiguous rollback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        })
      )
    );
    const listener = vi.fn();
    const unsubscribe = subscribeCustomerIdentityChange(listener);
    const pending = rollbackCustomerAuthSession('another-store');
    expect(listener).toHaveBeenCalledOnce();
    finish(new Response('{}', { status: 500 }));
    expect(await pending).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
