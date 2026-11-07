import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutAuthModal } from './checkout-auth-modal';

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ merchant: { slug: 'ogabassey' } }),
}));
vi.mock('@/components/storefront/checkout-code-signin', () => ({
  CheckoutCodeSignin: ({
    merchantSlug,
    onSuccess,
  }: {
    merchantSlug: string;
    onSuccess: () => void;
  }) => (
    <button type="button" onClick={onSuccess}>
      Email code for {merchantSlug}
    </button>
  ),
}));

describe('CheckoutAuthModal', () => {
  it('uses email-code sign-in and closes after success', () => {
    const success = vi.fn();
    const change = vi.fn();
    render(
      <CheckoutAuthModal isOpen onOpenChange={change} onSuccess={success} />
    );
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Email code for ogabassey' })
    );
    expect(success).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledWith(false);
  });
});
