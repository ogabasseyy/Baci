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

import { useMerchantSafe } from '@/hooks/use-merchant-client';
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

  it('uses the responsive overlay rather than a competing bottom-alignment utility', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);
    const overlay = screen.getByRole('dialog', { name: 'Let’s get you started' }).parentElement;
    expect(overlay?.className).toContain('overlay');
    expect(overlay).not.toHaveClass('items-end');
  });

  it('returns null when not open', () => {
    render(<CheckoutIdentityModal {...defaultProps} isOpen={false} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Checkout')).not.toBeInTheDocument();
  });

  it('shows email, social sign-in and guest options together', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveAttribute('placeholder', 'you@example.com');
    expect(screen.getByRole('button', { name: /continue as guest/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with apple/i })).toBeInTheDocument();
  });

  it('navigates to checkout on guest click and calls onClose', () => {
    const onProceed = vi.fn();
    render(<CheckoutIdentityModal {...defaultProps} onProceed={onProceed} />);

    fireEvent.click(
      screen.getByRole('button', { name: /continue as guest/i })
    );

    expect(mockPush).toHaveBeenCalledWith('/checkout');
    expect(onProceed).toHaveBeenCalledOnce();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('offers guest checkout if merchant identity is unavailable', () => {
    vi.mocked(useMerchantSafe).mockReturnValueOnce(null);
    render(<CheckoutIdentityModal {...defaultProps} />);
    expect(screen.getByText(/sign-in is currently unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Email address' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue as guest/i })).toBeInTheDocument();
  });

  it('offers guest checkout when the merchant has no slug', () => {
    const merchant = vi.mocked(useMerchantSafe)();
    if (!merchant?.merchant) throw new Error('Expected merchant fixture');
    vi.mocked(useMerchantSafe).mockReturnValueOnce({ ...merchant, merchant: { ...merchant.merchant, slug: '' } });
    render(<CheckoutIdentityModal {...defaultProps} />);
    expect(screen.getByText(/sign-in is currently unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue as guest/i })).toBeInTheDocument();
  });

  it('closes with Escape and exposes an accessible dialog', () => {
    const onClose = vi.fn();
    render(<CheckoutIdentityModal {...defaultProps} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Let’s get you started' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has a close button with proper aria-label', () => {
    render(<CheckoutIdentityModal {...defaultProps} />);

    const closeButton = screen.getByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();

    fireEvent.click(closeButton);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
