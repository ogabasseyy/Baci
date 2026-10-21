import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  getCartFromStorage,
  getCartSessionGeneration,
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

it('removes the selected variant after another writer reorders legacy same-product lines', () => {
  const red = cartItem({ cartItemId: undefined, selectedColor: 'Red' });
  const blue = cartItem({ cartItemId: undefined, selectedColor: 'Blue' });
  saveCartToStorage([red, blue], 'shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  saveCartToStorage([blue, red], 'shop');
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove Phone' })[0]);
  expect(getCartFromStorage('shop').map((item) => item.selectedColor)).toEqual([
    'Blue',
  ]);
});
it('does not remove a sibling after another writer already removed the selected variant', () => {
  const red = cartItem({ cartItemId: undefined, selectedColor: 'Red' });
  const blue = cartItem({ cartItemId: undefined, selectedColor: 'Blue' });
  saveCartToStorage([red, blue], 'shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  saveCartToStorage([blue], 'shop');
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove Phone' })[0]);
  expect(getCartFromStorage('shop').map((item) => item.selectedColor)).toEqual([
    'Blue',
  ]);
});
it.each([
  true,
  false,
])('removes exactly one duplicate saved line (stable IDs: %s)', (stableIds) => {
  const first = cartItem({
    cartItemId: stableIds ? 'first' : undefined,
    quantity: 1,
  });
  const second = cartItem({
    cartItemId: stableIds ? 'second' : undefined,
    quantity: 2,
  });
  saveCartToStorage([first, second], 'shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  saveCartToStorage([second, first], 'shop');
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove Phone' })[0]);
  expect(getCartFromStorage('shop')).toEqual([second]);
});
it('removes one indistinguishable legacy occurrence rather than all duplicates', () => {
  const duplicate = cartItem({ cartItemId: undefined });
  saveCartToStorage([duplicate, duplicate], 'shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove Phone' })[1]);
  expect(getCartFromStorage('shop')).toEqual([duplicate]);
});
it('does not remove a duplicate sibling when the selected stable ID was already removed', () => {
  const first = cartItem({ cartItemId: 'first' });
  const second = cartItem({ cartItemId: 'second', quantity: 2 });
  saveCartToStorage([first, second], 'shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  saveCartToStorage([second], 'shop');
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove Phone' })[0]);
  expect(getCartFromStorage('shop')).toEqual([second]);
});

it('removes a unique legacy line after its saved quantity changes', () => {
  const selected = cartItem({ cartItemId: undefined });
  saveCartToStorage([selected], 'shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  saveCartToStorage([{ ...selected, quantity: 3 }], 'shop');
  fireEvent.click(screen.getByRole('button', { name: 'Remove Phone' }));
  expect(getCartFromStorage('shop')).toEqual([]);
});

it('uses the stable saved ID even after a negotiation changes', () => {
  const selected = cartItem({
    cartItemId: 'selected',
    negotiatedPrice: 10,
    negotiationStatus: 'accepted',
  });
  saveCartToStorage([selected], 'shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  saveCartToStorage(
    [{ ...selected, negotiatedPrice: undefined, negotiationStatus: undefined }],
    'shop'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove Phone' }));
  expect(getCartFromStorage('shop')).toEqual([]);
});
it('does not write storage when a stale selected ID no longer exists', () => {
  const selected = cartItem({ cartItemId: 'selected' });
  saveCartToStorage([selected], 'shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  saveCartToStorage([], 'shop');
  const write = vi.spyOn(Storage.prototype, 'setItem');
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Remove Phone' }));
    expect(write).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
  }
});

it.each([
  'voucher',
  'negotiated',
])('removes only the selected same-ID %s lane', (kind) => {
  const plain = cartItem({ name: 'Plain' });
  const offer = cartItem({
    name: 'Offer',
    ...(kind === 'voucher'
      ? { quizVoucherToken: 'test-token', quizAwardId: 'test-award' }
      : { negotiatedPrice: 50, negotiationStatus: 'accepted' }),
  });
  saveCartToStorage([plain, offer], 'shop');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Offer' }));
  expect(getCartFromStorage('shop').map((item) => item.name)).toEqual([
    'Plain',
  ]);
});

it('fences the merchant session when removing a capacity line', () => {
  saveCartToStorage(
    [cartItem({ id: 'charger', cartItemId: 'charger', name: 'Charger' })],
    'shop'
  );
  window.localStorage.setItem('baci-cart-authority-epoch:shop', 'before');
  render(<DeviceCartCapacityItems merchantSlug="shop" />);
  const shopBefore = getCartSessionGeneration('shop');
  const otherBefore = getCartSessionGeneration('other-shop');
  fireEvent.click(screen.getByRole('button', { name: 'Remove Charger' }));
  expect(getCartFromStorage('shop')).toEqual([]);
  expect(getCartSessionGeneration('shop')).toBeGreaterThan(shopBefore);
  expect(getCartSessionGeneration('other-shop')).toBe(otherBefore);
  // The shared epoch rotates so other tabs fence their cloned creates.
  expect(
    window.localStorage.getItem('baci-cart-authority-epoch:shop')
  ).not.toBe('before');
});
