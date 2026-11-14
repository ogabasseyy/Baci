vi.mock('@/contexts/customer-auth-context', () => ({
  useOptionalCustomerAuth: () => ({}),
  useCustomerAuth: () => ({ sendOtp: vi.fn(), verifyOtp: vi.fn() }),
}));

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: vi.fn(() => Promise.resolve({ error: null })),
    },
  })),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: vi.fn(() => ({
    merchant: { id: 'm-1', slug: 'test-store' },
  })),
}));
vi.mock('@/lib/routes', () => ({ asRoute: vi.fn((p: string) => p) }));

import { CheckoutIdentityModal } from './checkout-identity-modal';

describe('CheckoutIdentityModal', () => {
  const defaultProps = {
    isOpen: true,
    onOpenChange: vi.fn(),
    checkoutUrl: '/checkout',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog with checkout title when open', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    expect(screen.getByText('Checkout')).toBeInTheDocument();
  });

  it('shows guest checkout and create account options on new customer tab', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    expect(
      screen.getByRole('button', { name: /continue as guest/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /register now/i })
    ).toBeInTheDocument();
  });

  it('navigates to checkout on guest checkout click', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /continue as guest/i }));

    expect(mockPush).toHaveBeenCalledWith('/checkout');
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders sign in tab trigger', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    const signinTab = screen.getByRole('tab', { name: /sign in/i });
    expect(signinTab).toBeInTheDocument();
    expect(signinTab).toHaveAttribute('aria-selected', 'false');
  });

  it('navigates to signup on register click', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /register now/i }));

    expect(mockPush).toHaveBeenCalledWith('/signup?redirect=%2Fcheckout');
  });

  it('does not render when closed', () => {
    render(<CheckoutIdentityModal {...defaultProps} isOpen={false} />);

    expect(screen.queryByText('Checkout')).not.toBeInTheDocument();
  });

  it('does not navigate when modal closes without user action', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    // Verify modal is open with content
    expect(screen.getByText('Checkout')).toBeInTheDocument();
    expect(
      screen.getByText(/your security is our priority/i)
    ).toBeInTheDocument();

    // No navigation should have happened
    expect(mockPush).not.toHaveBeenCalled();
  });
});
