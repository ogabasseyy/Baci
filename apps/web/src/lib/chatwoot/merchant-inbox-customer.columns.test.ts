import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verifier: vi.fn(), currency: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('./chat-customer-link-token', () => ({
  createChatCustomerLinkVerifier: mocks.verifier,
}));
vi.mock('./merchant-currency', () => ({
  loadChatwootMerchantCurrency: mocks.currency,
}));

import {
  loadCustomerBadges,
  loadCustomerProfile,
} from './merchant-inbox-customer';
import { A, db, MERCHANT } from './merchant-inbox-customer.test-support';

const selected = (seen: { table: string; filters: unknown[][] }[]) =>
  seen.flatMap(({ table, filters }) =>
    filters
      .filter(([name]) => name === 'select')
      .map(([, columns]) => `${table}: ${columns}`)
  );

beforeEach(() => {
  mocks.currency.mockResolvedValue({ currency: 'NGN' });
  mocks.verifier.mockResolvedValue(async () => ({
    merchantId: MERCHANT,
    customerId: A,
  }));
});

describe('bugfix: an undated order could push a recent one off the card', () => {
  it('asks for undated orders last', async () => {
    const { client, seen } = db({
      customers: { data: { id: A, full_name: 'Ada' } },
      orders: { data: [] },
    });

    await loadCustomerProfile({
      supabase: client,
      merchantId: MERCHANT,
      token: 'token',
      includeOrders: true,
    });

    expect(seen.flatMap((entry) => entry.filters)).toContainEqual([
      'order',
      'created_at',
      { ascending: false, nullsFirst: false },
    ]);
  });
});

describe('bugfix: the badge read could outlast the Customers scan', () => {
  it('gives the customer read a time limit of its own', async () => {
    const { client, seen } = db({ customers: { data: [{ id: A }] } });

    await loadCustomerBadges({
      supabase: client,
      merchantId: MERCHANT,
      links: { 1: 'token' },
      includeOrderData: false,
    });

    expect(seen.flatMap((entry) => entry.filters)).toContainEqual([
      'abortSignal',
      expect.any(AbortSignal),
    ]);
  });
});

describe('bugfix: order facts were read for staff without order access', () => {
  it('reads only the id for a badge', async () => {
    const { client, seen } = db({ customers: { data: [{ id: A }] } });

    await loadCustomerBadges({
      supabase: client,
      merchantId: MERCHANT,
      links: { 1: 'token' },
      includeOrderData: false,
    });

    expect(selected(seen)).toEqual(['customers: id']);
  });

  it('reads only the name for a card, and no orders', async () => {
    const { client, seen } = db({
      customers: { data: { id: A, full_name: 'Ada' } },
    });

    const profile = await loadCustomerProfile({
      supabase: client,
      merchantId: MERCHANT,
      token: 'token',
      includeOrders: false,
    });

    expect(selected(seen)).toEqual([
      'customers: id, full_name, first_name, last_name',
    ]);
    expect(profile).toMatchObject({ name: 'Ada', ordersHidden: true });
  });
});
