import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCheckoutUser } from './use-checkout-user';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), session: vi.fn() }));
vi.mock('@/contexts/auth-context', () => ({ useAuthSafe: mocks.auth }));
vi.mock('./use-checkout-session-user', () => ({ useCheckoutSessionUser: mocks.session }));

it('prefers the auth context and falls back to the storefront session', () => {
  mocks.auth.mockReturnValue({ user: { id: 'context' } });
  mocks.session.mockReturnValue({ id: 'session' });
  const { result, rerender } = renderHook(() => useCheckoutUser());
  expect(result.current?.id).toBe('context');
  mocks.auth.mockReturnValue(null);
  rerender();
  expect(result.current?.id).toBe('session');
});
