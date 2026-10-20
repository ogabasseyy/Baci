import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import {
  getCartFromStorage,
  getCartWideNegotiationFromStorage,
  saveCartToStorage,
  saveCartWideNegotiationToStorage,
} from '@/hooks/cart/cart-storage';
import { cartItem } from '@/hooks/cart/shared-cart-provisioning.test-support';
import { DeviceCartCapacityItems } from './device-cart-capacity-items';

beforeEach(() => window.localStorage.clear());
it('removes a chosen saved item while preserving other lines and merchant caches', () => {
  saveCartToStorage(
    [
      cartItem({ name: 'Phone', quizVoucherToken: 'private-test-voucher' }),
      cartItem({ id: 'charger', cartItemId: 'charger', name: 'Charger' }),
    ],
    'shop'
  );
  saveCartToStorage([cartItem()], 'other-shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  expect(
    screen.getByRole('list', { name: 'Saved device cart items' })
  ).toBeVisible();
  expect(screen.queryByText('private-test-voucher')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Charger' }));
  expect(getCartFromStorage('shop')).toHaveLength(1);
  expect(getCartFromStorage('shop')[0].quizVoucherToken).toBe(
    'private-test-voucher'
  );
  expect(getCartFromStorage('other-shop')).toHaveLength(1);
});

it('preserves concurrent saved-cart edits while removing the selected unchanged line', () => {
  const phone = cartItem({ name: 'Phone' });
  const charger = cartItem({
    id: 'charger',
    cartItemId: 'charger',
    name: 'Charger',
  });
  const cable = cartItem({ id: 'cable', cartItemId: 'cable', name: 'Cable' });
  saveCartToStorage([phone, charger], 'shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  saveCartToStorage([phone, charger, cable], 'shop');
  fireEvent.click(screen.getByRole('button', { name: 'Remove Charger' }));
  expect(getCartFromStorage('shop').map((item) => item.id)).toEqual([
    phone.id,
    cable.id,
  ]);
});

it.each([
  true,
  false,
])('invalidates group prices only for a group deal (%s)', (group) => {
  saveCartToStorage(
    [
      cartItem({
        name: 'Phone',
        negotiatedPrice: 100,
        negotiationStatus: 'accepted',
      }),
      cartItem({ id: 'charger', cartItemId: 'charger', name: 'Charger' }),
    ],
    'shop'
  );
  saveCartWideNegotiationToStorage(group, 'shop');
  saveCartWideNegotiationToStorage(true, 'other-shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Charger' }));
  expect(getCartFromStorage('shop')[0].negotiatedPrice).toBe(
    group ? undefined : 100
  );
  expect(getCartFromStorage('shop')[0].negotiationStatus).toBe(
    group ? undefined : 'accepted'
  );
  expect(getCartWideNegotiationFromStorage('shop')).toBe(false);
  expect(getCartWideNegotiationFromStorage('other-shop')).toBe(true);
});

it('removes the intended stable line after its saved quantity changes', () => {
  const selected = cartItem({ name: 'Phone' });
  saveCartToStorage([selected], 'shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  saveCartToStorage([{ ...selected, quantity: 2 }], 'shop');
  fireEvent.click(screen.getByRole('button', { name: 'Remove Phone' }));
  expect(getCartFromStorage('shop')).toEqual([]);
});
