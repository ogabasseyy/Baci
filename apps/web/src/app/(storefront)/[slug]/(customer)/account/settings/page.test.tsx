import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import CustomerSettingsPage from './page';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({ loading: false }),
}));
vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({ currencySymbol: '₦' }),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: () => ({
    customer: {
      first_name: 'Shopper',
      last_name: 'One',
      email: 'fixture@example.invalid',
    },
    isAuthenticated: true,
    isLoading: false,
    logout: mocks.logout,
    updateCustomer: vi.fn(),
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
});
it('keeps the shopper on settings and offers retry when cart revocation prevents logout', async () => {
  mocks.logout.mockRejectedValue(new Error('revocation unavailable'));
  render(<CustomerSettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
  await waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not sign out',
        variant: 'destructive',
      })
    )
  );
  expect(mocks.push).not.toHaveBeenCalled();
});
it('navigates away only after logout is acknowledged', async () => {
  mocks.logout.mockResolvedValue(undefined);
  render(<CustomerSettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/'));
  expect(mocks.toast).not.toHaveBeenCalled();
});
