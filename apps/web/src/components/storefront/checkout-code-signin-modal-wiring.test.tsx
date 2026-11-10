import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CheckoutIdentityModal as GenericModal } from './checkout-identity-modal';
import { CheckoutIdentityModal as OgabasseyModal } from './ogabassey/components/CheckoutIdentityModal';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ merchant: { slug: 'shop' } }),
}));
vi.mock('@/components/storefront/checkout-code-signin', () => ({
  CheckoutCodeSignin: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" onClick={onSuccess}>
      Complete code verification
    </button>
  ),
}));
it.each([
  'generic',
  'ogabassey',
])('resumes the saved checkout after verified code in %s modal', (variant) => {
  const close = vi.fn();
  if (variant === 'generic')
    render(
      <GenericModal
        isOpen
        onOpenChange={close}
        checkoutUrl="/shop/checkout?resume=1"
      />
    );
  else
    render(
      <OgabasseyModal
        isOpen
        onClose={close}
        checkoutUrl="/shop/checkout?resume=1"
      />
    );
  if (variant === 'generic') {
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Sign In' }), {
      button: 0,
      ctrlKey: false,
    });
  }
  fireEvent.click(
    screen.getByRole('button', { name: 'Complete code verification' })
  );
  expect(push).toHaveBeenLastCalledWith('/shop/checkout?resume=1');
  expect(close).toHaveBeenCalledOnce();
});
