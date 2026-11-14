import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CHECKOUT_AUTH_CHANGED } from '@/components/storefront/checkout-auth-notification';
import { useCheckoutSessionUser } from './use-checkout-session-user';

const auth = vi.hoisted(() => ({ getUser: vi.fn(), unsubscribe: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }));
beforeEach(() => {
  vi.clearAllMocks();
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: auth.unsubscribe } } });
});
it('recognises a session after navigation from the cart', async () => {
  auth.getUser.mockResolvedValue({ data: { user: { id: 'customer-1', email: 'buyer@example.test' } }, error: null });
  const { result } = renderHook(() => useCheckoutSessionUser());
  await waitFor(() => expect(result.current?.id).toBe('customer-1'));
});
it('refreshes checkout after email-code sign-in', async () => {
  auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null }).mockResolvedValue({ data: { user: { id: 'customer-2' } }, error: null });
  const { result } = renderHook(() => useCheckoutSessionUser());
  await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(1));
  act(() => window.dispatchEvent(new Event(CHECKOUT_AUTH_CHANGED)));
  await waitFor(() => expect(result.current?.id).toBe('customer-2'));
});
it('clears an existing signed-in customer when session lookup fails', async () => {
  auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'customer-1' } }, error: null }).mockResolvedValue({ data: { user: { id: 'stale-customer' } }, error: new Error('unavailable') });
  const { result } = renderHook(() => useCheckoutSessionUser());
  await waitFor(() => expect(result.current?.id).toBe('customer-1'));
  act(() => window.dispatchEvent(new Event(CHECKOUT_AUTH_CHANGED)));
  await waitFor(() => expect(result.current).toBeNull());
});
