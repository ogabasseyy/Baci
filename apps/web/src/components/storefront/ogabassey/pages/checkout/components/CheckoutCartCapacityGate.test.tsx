import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CheckoutCartCapacityGate } from './CheckoutCartCapacityGate';

const cart = vi.hoisted(() => ({
  sharedCartEnabled: true,
  syncStatus: 'synced' as string,
  importWarnings: [] as string[],
  importConflicts: [],
  resolveImportConflicts: vi.fn(),
  discardLegacyImport: vi.fn(),
  returnToCart: vi.fn(),
}));
vi.mock('@/hooks/cart', () => ({ useCart: () => cart }));
beforeEach(() => {
  cart.sharedCartEnabled = true;
  cart.syncStatus = 'synced';
  cart.importWarnings = [];
  vi.clearAllMocks();
});
it('offers retry and discard instead of payment controls on direct checkout', () => {
  cart.importWarnings = ['import_capacity_exceeded'];
  const view = render(
    <CheckoutCartCapacityGate onReturnToCart={cart.returnToCart}>
      <button type="button">Place Order</button>
    </CheckoutCartCapacityGate>
  );
  expect(screen.queryByRole('button', { name: 'Place Order' })).toBeNull();
  expect(
    screen.getByRole('region', { name: 'Cart import capacity' })
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry importing device cart' })
  );
  expect(cart.resolveImportConflicts).toHaveBeenCalledWith([]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit cart items' }));
  expect(cart.returnToCart).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Keep shared cart and discard saved device cart',
    })
  );
  expect(cart.discardLegacyImport).toHaveBeenCalledOnce();
  cart.importWarnings = [];
  view.rerender(
    <CheckoutCartCapacityGate onReturnToCart={cart.returnToCart}>
      <button type="button">Place Order</button>
    </CheckoutCartCapacityGate>
  );
  expect(screen.getByRole('button', { name: 'Place Order' })).toBeVisible();
  expect(
    screen.queryByRole('button', {
      name: 'Keep shared cart and discard saved device cart',
    })
  ).toBeNull();
});
it('preserves ordinary checkout when shared carts are disabled', () => {
  cart.sharedCartEnabled = false;
  cart.importWarnings = ['import_capacity_exceeded'];
  render(
    <CheckoutCartCapacityGate onReturnToCart={cart.returnToCart}>
      <p>Checkout</p>
    </CheckoutCartCapacityGate>
  );
  expect(screen.getByText('Checkout')).toBeVisible();
  expect(
    screen.queryByRole('region', { name: 'Cart import capacity' })
  ).toBeNull();
});

it('lets existing order resume reach its own authorization and payment gate', () => {
  cart.importWarnings = ['import_capacity_exceeded'];
  render(
    <CheckoutCartCapacityGate validatedResume cartHref="/shop/cart">
      <p>Resume order</p>
    </CheckoutCartCapacityGate>
  );
  expect(screen.getByText('Resume order')).toBeVisible();
  expect(
    screen.queryByRole('region', { name: 'Cart import capacity' })
  ).toBeNull();
});

it('does not bypass recovery for an unvalidated order query', () => {
  window.history.replaceState({}, '', '/checkout?orderId=not-authorized');
  cart.importWarnings = ['import_capacity_exceeded'];
  render(
    <CheckoutCartCapacityGate>
      <button type="button">Place Order</button>
    </CheckoutCartCapacityGate>
  );
  expect(screen.queryByRole('button', { name: 'Place Order' })).toBeNull();
  expect(
    screen.getByRole('region', { name: 'Cart import capacity' })
  ).toBeVisible();
  window.history.replaceState({}, '', '/');
});

it('does not mount checkout while shared-cart import resolution is pending', () => {
  cart.syncStatus = 'pending';
  render(
    <CheckoutCartCapacityGate onReturnToCart={cart.returnToCart}>
      <button type="button">Place Order</button>
    </CheckoutCartCapacityGate>
  );
  expect(screen.queryByRole('button', { name: 'Place Order' })).toBeNull();
  expect(screen.getByRole('status', { name: 'Loading your cart' })).toBeVisible();
});
