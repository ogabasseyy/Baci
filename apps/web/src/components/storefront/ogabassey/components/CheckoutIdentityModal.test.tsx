vi.mock('@/contexts/customer-auth-context', () => ({ useOptionalCustomerAuth: () => ({}), useCustomerAuth: () => ({ sendOtp: vi.fn(), verifyOtp: vi.fn() }) }));
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}));

const mockSignInWithPassword = vi.fn(() =>
  Promise.resolve({ error: null })
);
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
    },
  })),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: vi.fn(() => ({
    merchant: { id: 'm-1', slug: 'test-store' },
  })),
}));
vi.mock('@/lib/routes', () => ({ asRoute: vi.fn((p: string) => p) }));
vi.mock('@/lib/utils', () => ({ cn: vi.fn((...args: string[]) => args.filter(Boolean).join(' ')) }));

import { CheckoutIdentityModal } from './CheckoutIdentityModal';

describe('CheckoutIdentityModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInWithPassword.mockResolvedValue({ error: null });
  });

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    checkoutUrl: '/checkout',
  };

  it('renders modal with checkout header when open', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    expect(screen.getByText('Checkout')).toBeInTheDocument();
  });

  it('returns null when not open', () => {
    render(<CheckoutIdentityModal {...defaultProps} isOpen={false} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Checkout')).not.toBeInTheDocument();
  });

  it('shows guest checkout and create account options', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    expect(
      screen.getByRole('button', { name: /continue as guest/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /register now/i })
    ).toBeInTheDocument();
  });

  it('navigates to checkout on guest click and calls onClose', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    fireEvent.click(
      screen.getByRole('button', { name: /continue as guest/i })
    );

    expect(mockPush).toHaveBeenCalledWith('/checkout');
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('switches to sign-in tab and shows login form', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(
      screen.getByRole('textbox', { name: 'Email address' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /send sign-in code/i })
    ).toBeInTheDocument();
  });

  it('navigates to signup with encoded redirect on register click', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /register now/i }));

    expect(mockPush).toHaveBeenCalledWith('/signup?redirect=%2Fcheckout');
  });

  it('has a close button with proper aria-label', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    const closeButton = screen.getByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();

    fireEvent.click(closeButton);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
