import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutAuthModal } from './checkout-auth-modal';
import { CHECKOUT_AUTH_CHANGED } from './checkout-auth-notification';

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ merchant: { slug: 'ogabassey' } }),
}));
vi.mock('@/components/storefront/checkout-code-signin', () => ({
  CheckoutCodeSignin: ({
    merchantSlug,
    onSuccess,
    socialReturnTo,
  }: {
    merchantSlug: string;
    onSuccess: () => void;
    socialReturnTo?: string;
  }) => (
    <>
      <button type="button" onClick={onSuccess}>
        Email code for {merchantSlug}
      </button>
      {socialReturnTo && <span>Social return: {socialReturnTo}</span>}
    </>
  ),
}));

describe('CheckoutAuthModal', () => {
  it('offers social sign-in with the current checkout return on a supported host', () => {
    window.history.replaceState({}, '', '/checkout?step=delivery');
    render(
      <CheckoutAuthModal isOpen onOpenChange={vi.fn()} onSuccess={vi.fn()} />
    );
    expect(
      screen.getByText('Social return: /checkout?step=delivery')
    ).toBeInTheDocument();
    window.history.replaceState({}, '', '/');
  });
  it('uses email-code sign-in and closes after success', () => {
    const success = vi.fn();
    const change = vi.fn();
    render(
      <CheckoutAuthModal isOpen onOpenChange={change} onSuccess={success} />
    );
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    const listener = vi.fn();
    window.addEventListener(CHECKOUT_AUTH_CHANGED, listener);
    fireEvent.click(
      screen.getByRole('button', { name: 'Email code for ogabassey' })
    );
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(CHECKOUT_AUTH_CHANGED, listener);
    expect(success).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledWith(false);
  });
});
