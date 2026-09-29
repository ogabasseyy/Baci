import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CheckoutPage from './page';

const { lifecycle, replace } = vi.hoisted(() => ({
  lifecycle: vi.fn(),
  replace: vi.fn(),
}));

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
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
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

    expect(lifecycle).toHaveBeenCalledWith('store', expect.any(Function));
    expect(
      screen.getByRole('status', { name: 'Loading checkout' })
    ).toBeInTheDocument();
  });
});
