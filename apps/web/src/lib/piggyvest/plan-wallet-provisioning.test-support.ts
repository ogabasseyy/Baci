import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

/** Shared provider and Supabase doubles for the ensurePlanWallet suites. */

export const SCOPE = {
  customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  merchantId: '43e157b6-179c-432a-9392-e0827da96d82',
};

export const CONFIG = {
  baseUrl: 'https://staging.example.com',
  token: 'synthetic',
};

export const ROW = {
  piggyvest_customer_id: 'pvb-customer-synthetic-001',
  wallet_id: 'pvb-wallet-synthetic-001',
  subaccount_name: 'BACI PLAN 43E157B6 C0065070',
  status: 'provisioning',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

export function mockSupabase(options: {
  singles?: Array<{ data: unknown; error: unknown }>;
  lists?: Array<{ data: unknown; error: unknown }>;
}): {
  client: SupabaseClient;
  upsert: ReturnType<typeof vi.fn>;
} {
  const singleQueue = [...(options.singles ?? [])];
  const listQueue = [...(options.lists ?? [])];
  const maybeSingle = vi.fn(async () => singleQueue.shift());
  const then = (resolve: (value: unknown) => void) =>
    Promise.resolve(listQueue.shift() ?? { data: [], error: null }).then(
      resolve
    );
  const upsert = vi.fn(() => {
    const then = (resolve: (value: unknown) => void) =>
      Promise.resolve({ error: null }).then(resolve);
    return { then };
  });
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    maybeSingle,
    select: vi.fn(() => chain),
    then,
    upsert,
  });
  return {
    client: { from: vi.fn(() => chain) } as unknown as SupabaseClient,
    upsert,
  };
}

export function stubProvider(
  impl: (url: string) => Response | Promise<Response>
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => impl(url))
  );
}

export const retrieveBody = {
  status: true,
  message: 'Wallet details fetched',
  data: {
    id: 'pvb-wallet-synthetic-001',
    business_id: 'business-synthetic-001',
    virtual_account_id: null,
    currency: 'NGN',
    name: 'BACI PLAN 43E157B6 C0065070',
    status: 'active',
    type: 'api',
    balance: 5000000,
    withdrawal_count: 0,
    creation_interest_rate: 0,
    current_interest_rate: 0,
  },
};

export const accountsBody = {
  status: true,
  message: 'Fetched virtual accounts for wallet',
  data: [
    {
      account_number: '9000000001',
      account_name: 'SYNTHETIC PLAN WALLET',
      bank_name: 'Synthetic Bank',
      paypoint_name: null,
      paypoint_id: null,
    },
  ],
};
