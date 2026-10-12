import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CheckoutPage from './page';

const { apiPost, lifecycle, replace } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  lifecycle: vi.fn(),
  replace: vi.fn(),
}));

const otpUser = { id: 'user-9', email: 'buyer@example.com' };
const otpCustomer = { first_name: 'Ada', email: 'buyer@example.com' };

vi.mock('@/hooks/use-checkout-customer-lifecycle', () => ({
  useCheckoutCustomerLifecycle: (...args: unknown[]) => lifecycle(...args),
}));
vi.mock('@/hooks/use-cart', () => ({
  useCart: () => ({
    cart: [],
    cartCount: 1,
    cartTotal: 0,
    clearCart: vi.fn(),
    merchantSlug: 'store',
  }),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  MerchantProvider: ({ children }: { children: React.ReactNode }) => children,
  useMerchant: () => ({ merchant: null, basePath: '' }),
}));
vi.mock('@/components/checkout-theme-provider', () => ({
  CheckoutThemeProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({ currencyCode: 'NGN', formatCurrency: String }),
  useCurrencyWithCountry: () => ({
    currencyCode: 'NGN',
    formatCurrency: String,
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/api-client', () => ({
  apiPost: (...args: unknown[]) => apiPost(...args),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: otpUser } }) },
  }),
}));

describe('CheckoutPage customer lifecycle integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifecycle.mockReturnValue({
      handleAuthSuccess: vi.fn(),
      handleGuestCheckout: vi.fn(),
      pageLoading: true,
      setStep: vi.fn(),
      step: 0,
    });
  });

  it('uses the merchant identity lifecycle to gate checkout rendering', () => {
    render(<CheckoutPage />);

    expect(lifecycle).toHaveBeenCalledWith(
      'store',
      expect.any(Function),
      expect.any(Function)
    );
    expect(
      screen.getByRole('status', { name: 'Loading checkout' })
    ).toBeInTheDocument();
  });

  it('wires guest checkout through the step-0 auth gate', () => {
    const handleGuestCheckout = vi.fn();
    lifecycle.mockReturnValue({
      handleAuthSuccess: vi.fn(),
      handleGuestCheckout,
      pageLoading: false,
      setStep: vi.fn(),
      step: 0,
    });

    render(<CheckoutPage />);

    expect(
      screen.queryByRole('status', { name: 'Loading checkout' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue as guest' }));
    expect(handleGuestCheckout).toHaveBeenCalledTimes(1);
  });

  it('wires OTP auth success through the step-0 auth gate', async () => {
    const handleAuthSuccess = vi.fn();
    lifecycle.mockReturnValue({
      handleAuthSuccess,
      handleGuestCheckout: vi.fn(),
      pageLoading: false,
      setStep: vi.fn(),
      step: 0,
    });
    apiPost.mockImplementation(async (url: string) =>
      url.includes('verify-code') ? { customer: otpCustomer } : {}
    );

    render(<CheckoutPage />);

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'buyer@example.com' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with email' })
    );
    await screen.findByLabelText('Verification code digit 1');
    for (let index = 1; index <= 6; index += 1) {
      fireEvent.change(
        screen.getByLabelText(`Verification code digit ${index}`),
        { target: { value: String(index % 10) } }
      );
    }

    await waitFor(() =>
      expect(handleAuthSuccess).toHaveBeenCalledWith(otpUser, otpCustomer)
    );
  });
});
