import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { revokeCartDeviceSession } from '@/hooks/cart/shared-cart-session-revoke-client';
import { CustomerAuthProvider, useCustomerAuth } from './customer-auth-context';

vi.mock('@/hooks/cart/shared-cart-session-revoke-client', () => ({
  revokeCartDeviceSession: vi.fn(),
}));
vi.mock('@/hooks/use-cart', () => ({ clearCartStorage: vi.fn() }));
function Probe() {
  const auth = useCustomerAuth();
  return (
    <>
      <span>{auth.isAuthenticated ? 'signed-in' : 'guest'}</span>
      <button
        type="button"
        onClick={() => void auth.logout().catch(() => undefined)}
      >
        Sign out
      </button>
    </>
  );
}
it('does not report logout success while device-cart revocation failed', async () => {
  vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: false });
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      authenticated: true,
      user: { id: 'user', email: 'buyer@example.com', role: 'customer' },
      customer: {
        id: 'customer',
        email: 'buyer@example.com',
        first_name: 'Buyer',
        last_name: 'One',
      },
    })
  );
  vi.stubGlobal('fetch', fetchMock);
  try {
    render(
      <CustomerAuthProvider merchantSlug="shop">
        <Probe />
      </CustomerAuthProvider>
    );
    await screen.findByText('signed-in');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    });
    await waitFor(() => expect(revokeCartDeviceSession).toHaveBeenCalled());
    expect(screen.getByText('signed-in')).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === '/api/storefront/auth/logout'
      )
    ).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
