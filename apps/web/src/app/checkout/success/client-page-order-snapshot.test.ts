// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLastOrderSnapshot,
  getServerLastOrderSnapshot,
  notifyLastOrderSnapshotChanged,
  parseOrderSnapshot,
  subscribeToLastOrderSnapshot,
} from './client-page-order-snapshot';

const order = {
  order_number: 'BAC-1001',
  shipping: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    address: '1 Algorithm Lane',
    city: 'Lagos',
    state: 'LA',
  },
  items: [
    {
      id: 'item-1',
      name: 'Wireless Charger',
      price: 2000,
      quantity: 2,
      image: '/charger.jpg',
    },
  ],
  shipping_fee: 0,
};

describe('checkout success order snapshot helpers', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('parses valid order snapshots and rejects invalid snapshots', () => {
    expect(parseOrderSnapshot('')).toBeNull();
    expect(parseOrderSnapshot('{bad json')).toBeNull();
    expect(parseOrderSnapshot(JSON.stringify({ items: [] }))).toBeNull();
    expect(parseOrderSnapshot(JSON.stringify(order))).toMatchObject({
      order_number: 'BAC-1001',
      shipping: { email: 'ada@example.com' },
    });
  });

  it('allows free items and rejects negative totals or blank shipping fields', () => {
    expect(
      parseOrderSnapshot(
        JSON.stringify({
          ...order,
          items: [{ ...order.items[0], price: 0 }],
        })
      )
    ).toMatchObject({
      items: [expect.objectContaining({ price: 0 })],
    });
    expect(
      parseOrderSnapshot(
        JSON.stringify({
          ...order,
          items: [{ ...order.items[0], price: -1 }],
        })
      )
    ).toBeNull();
    expect(
      parseOrderSnapshot(
        JSON.stringify({
          ...order,
          items: [{ ...order.items[0], quantity: 0 }],
        })
      )
    ).toBeNull();
    expect(
      parseOrderSnapshot(
        JSON.stringify({
          ...order,
          shipping: { ...order.shipping, email: '   ' },
        })
      )
    ).toBeNull();
  });

  it('returns an empty server snapshot for stable hydration', () => {
    expect(getServerLastOrderSnapshot()).toBe('');
  });

  it('reads and subscribes to tab-scoped order snapshot changes', () => {
    const listener = vi.fn();
    sessionStorage.setItem('lastOrder', JSON.stringify(order));

    expect(getLastOrderSnapshot()).toBe(JSON.stringify(order));

    const unsubscribe = subscribeToLastOrderSnapshot(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: 'lastOrder' }));
    notifyLastOrderSnapshotChanged();

    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    notifyLastOrderSnapshotChanged();

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
