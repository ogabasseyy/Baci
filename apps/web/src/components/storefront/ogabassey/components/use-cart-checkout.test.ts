import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCartCheckout } from './use-cart-checkout';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), push: vi.fn() }));
vi.mock('@/contexts/auth-context', () => ({ useAuthSafe: () => null }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/routes', () => ({ asRoute: (path: string) => path }));

beforeEach(() => { vi.useFakeTimers(); mocks.getUser.mockReset(); mocks.push.mockReset(); });
afterEach(() => vi.useRealTimers());

it('opens the identity choice after a stalled lookup and ignores a late session', async () => {
  let resolveLookup: (value: unknown) => void = () => {};
  mocks.getUser.mockReturnValue(new Promise((resolve) => { resolveLookup = resolve; }));
  const close = vi.fn();
  const { result } = renderHook(() => useCartCheckout(true, close, '/checkout'));
  let pending: Promise<void> | undefined;
  act(() => { pending = result.current.handleCheckout(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); await pending; });
  expect(result.current.isIdentityOpen).toBe(true);
  expect(result.current.isCheckoutLoading).toBe(false);
  await act(async () => { resolveLookup({ data: { user: { id: '1' } }, error: null }); });
  expect(mocks.push).not.toHaveBeenCalled();
});
