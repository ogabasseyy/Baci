import { vi } from 'vitest';

export const existingAccountRow = {
  id: 'wallet-account-1',
  merchant_id: 'merchant-1',
  customer_id: 'customer-1',
  provider: 'paystack',
  provider_customer_code: 'CUS_existing',
  provider_subaccount_code: 'ACCT_merchant123',
  provider_account_id: '97',
  account_number: '1234567890',
  account_name: 'Ogabassey/Jane Doe',
  bank_name: 'Wema Bank',
  bank_slug: 'wema-bank',
  currency: 'NGN',
  status: 'active',
  metadata: {},
  consented_at: '2026-05-21T10:00:00.000Z',
};

export const merchant = {
  business_name: 'Ogabassey',
  id: 'merchant-1',
  paystack_subaccount_code: 'ACCT_merchant123',
};

export const customer = {
  email: 'jane@example.com',
  first_name: 'Jane',
  id: 'customer-1',
  last_name: 'Doe',
  phone: '+2348012345678',
};

export function createMaybeSingleQuery(data: unknown) {
  const query: Record<string, unknown> = {};
  const select = vi.fn(() => query);
  const eq = vi.fn(() => query);
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  Object.assign(query, { eq, maybeSingle, select });
  return query;
}

export function createInsertQuery(data: unknown) {
  const query: Record<string, unknown> = {};
  const insert = vi.fn(() => query);
  const select = vi.fn(() => query);
  const single = vi.fn().mockResolvedValue({ data, error: null });
  Object.assign(query, { insert, select, single });
  return { insert, query };
}

export function createInsertErrorQuery(error: unknown) {
  const query: Record<string, unknown> = {};
  const insert = vi.fn(() => query);
  const select = vi.fn(() => query);
  const single = vi.fn().mockResolvedValue({ data: null, error });
  Object.assign(query, { insert, select, single });
  return { insert, query };
}

export function createUpdateQuery(data: unknown) {
  const query: Record<string, unknown> = {};
  const update = vi.fn(() => query);
  const eq = vi.fn(() => query);
  const neq = vi.fn(() => query);
  const select = vi.fn(() => query);
  const single = vi.fn().mockResolvedValue({ data, error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  Object.assign(query, { eq, maybeSingle, neq, select, single, update });
  return { maybeSingle, neq, query, update };
}

export function createSelectRowsQuery(data: unknown[]) {
  const query: Record<string, unknown> = {};
  const select = vi.fn(() => query);
  const eq = vi.fn(() => query);
  const then = (resolve: unknown, reject: unknown) =>
    Promise.resolve({ data, error: null }).then(
      resolve as Parameters<Promise<unknown>['then']>[0],
      reject as Parameters<Promise<unknown>['then']>[1]
    );
  Object.assign(query, { eq, select, then });
  return query;
}
