import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeferredCheckoutAuthModal } from './DeferredCheckoutAuthModal';

vi.mock('@/hooks/use-merchant-client', () => ({ useMerchantSafe: () => ({ merchant: { slug: 'shop' } }) }));
vi.mock('@/components/storefront/checkout-code-signin', () => ({ CheckoutCodeSignin: () => <button type="button">Send sign-in code</button> }));

it('loads the deferred dialog and preserves its dismissal action', async () => {
  const onClose = vi.fn();
  render(
    <DeferredCheckoutAuthModal
      isOpen
      onOpenChange={onClose}
      onSuccess={vi.fn()}
    />
  );

  expect(
    await screen.findByRole('button', { name: 'Send sign-in code' }, { timeout: 5000 })
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /close/i }));

  expect(onClose).toHaveBeenCalledTimes(1);
});
