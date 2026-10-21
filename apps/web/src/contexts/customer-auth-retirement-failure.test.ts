import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { revokeCartDeviceSession } from '@/hooks/cart/shared-cart-session-revoke-client';
import {
  loadCustomerSession,
  performCustomerLogout,
  resetRememberedCustomerSessionsForTests,
} from './customer-auth-session';

const release = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/cart/cart-session-write-fence', () => ({
  beginCartSessionRetirement: () => ({
    drained: Promise.reject(new Error('storage denied')),
    release,
  }),
}));
vi.mock('@/hooks/cart/shared-cart-session-revoke-client', () => ({
  revokeCartDeviceSession: vi.fn(),
  markCartDeviceRevocationPending: vi.fn(),
  clearCartDeviceRevocationPending: vi.fn(),
  resetPendingCartDeviceRevocationsForTests: vi.fn(),
}));
vi.mock('@/hooks/use-cart', () => ({ clearCartStorage: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  resetRememberedCustomerSessionsForTests();
});
it('reports the friendly logout failure when retirement acquisition rejects', async () => {
  const setUser = vi.fn();
  await expect(
    performCustomerLogout('shop', setUser, vi.fn(), vi.fn(), 'old')
  ).rejects.toThrow('Could not safely sign out');
  expect(setUser).not.toHaveBeenCalled();
  expect(revokeCartDeviceSession).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

afterEach(() => vi.unstubAllGlobals());
it('does not adopt a replacement account when retirement acquisition rejects', async () => {
  const session = (id: string) =>
    Response.json({
      authenticated: true,
      user: { id, email: `${id}@example.com`, role: 'customer' },
      customer: {
        id: `customer-${id}`,
        email: `${id}@example.com`,
        first_name: id,
        last_name: 'Buyer',
      },
    });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(session('old'))
      .mockResolvedValueOnce(session('new'))
      .mockResolvedValue(Response.json({ ok: true }))
  );
  const setUser = vi.fn();
  const callbacks = { setUser, setCustomer: vi.fn(), setIsLoading: vi.fn() };
  await loadCustomerSession('shop', callbacks);
  await expect(loadCustomerSession('shop', callbacks)).resolves.toBeUndefined();
  expect(setUser).not.toHaveBeenCalledWith(
    expect.objectContaining({ id: 'new' })
  );
  expect(revokeCartDeviceSession).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});
