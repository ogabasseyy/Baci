import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verifier: vi.fn(), currency: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('./chat-customer-link-token', () => ({
  createChatCustomerLinkVerifier: mocks.verifier,
}));
vi.mock('./merchant-currency', () => ({
  loadChatwootMerchantCurrency: mocks.currency,
}));

import { loadCustomerProfile } from './merchant-inbox-customer';
import { A, db, MERCHANT } from './merchant-inbox-customer.test-support';
import { MerchantInboxCustomerUnavailableError } from './merchant-inbox-customer-unavailable';

const customer = {
  id: A,
  full_name: 'Ada Obi',
  first_name: 'Ada',
  last_name: 'Obi',
  created_at: '2025-01-02T00:00:00Z',
  total_orders: 5,
  total_spent: 412000,
  loyalty_points: 120,
};

const load = (client: never, includeOrders: boolean) =>
  loadCustomerProfile({
    supabase: client,
    merchantId: MERCHANT,
    token: 'good',
    includeOrders,
  });

beforeEach(() => {
  mocks.currency.mockResolvedValue({ currency: 'NGN' });
  mocks.verifier.mockResolvedValue(async () => ({
    merchantId: MERCHANT,
    customerId: A,
  }));
});

describe('bugfix: unreadable records are unavailable, not "no customer" or "no orders"', () => {
  it('fails when the customer row cannot be read', async () => {
    const { client } = db({
      customers: { data: null, error: { message: 'statement timeout' } },
    });

    await expect(load(client, true)).rejects.toBeInstanceOf(
      MerchantInboxCustomerUnavailableError
    );
  });

  it('fails when the recent orders cannot be read, instead of an empty history', async () => {
    const { client } = db({
      customers: { data: customer },
      orders: { data: null, error: { message: 'statement timeout' } },
    });

    await expect(load(client, true)).rejects.toBeInstanceOf(
      MerchantInboxCustomerUnavailableError
    );
  });

  it('still answers a customer that is simply not in this store as no card', async () => {
    const { client } = db({ customers: { data: null } });

    await expect(load(client, true)).resolves.toBeNull();
  });

  it('does not read orders, so an order outage cannot fail a caller without order access', async () => {
    const { client, seen } = db({
      customers: { data: customer },
      orders: { data: null, error: { message: 'statement timeout' } },
    });

    const profile = await load(client, false);

    expect(profile).toMatchObject({ name: 'Ada Obi', ordersHidden: true });
    expect(seen.map((entry) => entry.table)).not.toContain('orders');
  });
});
