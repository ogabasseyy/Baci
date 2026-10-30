import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCustomerAuthMutation } from './customer-auth-mutation';
import { subscribeCustomerIdentityChange } from './customer-live-identity';

afterEach(() => vi.unstubAllGlobals());

describe('customer auth mutations', () => {
  it('invalidates account views before and after a rejected request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const listener = vi.fn();
    const unsubscribe = subscribeCustomerIdentityChange(listener);
    await expect(
      fetchCustomerAuthMutation('ogabassey', '/test', { method: 'POST' })
    ).rejects.toThrow('offline');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
