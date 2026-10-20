import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CheckoutCartCapacityGate } from './CheckoutCartCapacityGate';

const cart = vi.hoisted(() => ({
  sharedCartEnabled: true,
  importWarnings: [] as string[],
  importConflicts: [],
  resolveImportConflicts: vi.fn(),
  discardLegacyImport: vi.fn(),
}));
vi.mock('@/hooks/cart', () => ({ useCart: () => cart }));
beforeEach(() => {
  cart.sharedCartEnabled = true;
  cart.importWarnings = [];
  vi.clearAllMocks();
});
it('offers retry and discard instead of payment controls on direct checkout', () => {
  cart.importWarnings = ['import_capacity_exceeded'];
  const view = render(<CheckoutCartCapacityGate><button type="button">Place Order</button></CheckoutCartCapacityGate>);
  expect(screen.queryByRole('button', { name: 'Place Order' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Cart import capacity' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Retry importing device cart' }));
  expect(cart.resolveImportConflicts).toHaveBeenCalledWith([]);
  fireEvent.click(screen.getByRole('button', { name: 'Keep shared cart and discard saved device cart' }));
  expect(cart.discardLegacyImport).toHaveBeenCalledOnce();
  cart.importWarnings = [];
  view.rerender(<CheckoutCartCapacityGate><button type="button">Place Order</button></CheckoutCartCapacityGate>);
  expect(screen.getByRole('button', { name: 'Place Order' })).toBeVisible();
});
it('preserves ordinary checkout when shared carts are disabled', () => {
  cart.sharedCartEnabled = false;
  cart.importWarnings = ['import_capacity_exceeded'];
  render(<CheckoutCartCapacityGate><p>Checkout</p></CheckoutCartCapacityGate>);
  expect(screen.getByText('Checkout')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Cart import capacity' })).toBeNull();
});
