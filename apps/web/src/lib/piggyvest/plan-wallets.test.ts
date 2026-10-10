import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { getPlanWalletSnapshot, PlanWalletError } from './plan-wallets';

const SCOPE = {
  customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  merchantId: '43e157b6-179c-432a-9392-e0827da96d82',
};

const CONFIG = { baseUrl: 'https://staging.example.com', token: 'synthetic' };

const ROW = {
  piggyvest_customer_id: 'pvb-customer-synthetic-001',
  wallet_id: 'pvb-wallet-synthetic-001',
  subaccount_name: 'BACI PLAN 43E157B6 C0065070',
  status: 'provisioning',
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

function mockSupabase(options: {
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

function stubProvider(impl: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => impl(url))
  );
}

const retrieveBody = {
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

const accountsBody = {
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

describe('getPlanWalletSnapshot', () => {
  it('returns none without provider calls when no wallet is mapped', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { client } = mockSupabase({ singles: [{ data: null, error: null }] });

    const snapshot = await getPlanWalletSnapshot(client, CONFIG, SCOPE);

    expect(snapshot.status).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('fails closed when the provider is not configured', async () => {
    const { client } = mockSupabase({ singles: [{ data: null, error: null }] });

    const error = await getPlanWalletSnapshot(client, null, SCOPE).catch(
      (cause: unknown) => cause
    );

    expect(error).toBeInstanceOf(PlanWalletError);
    expect(error).toMatchObject({ code: 'PLAN_WALLET_NOT_CONFIGURED' });
  });

  it('returns ready with live balance and funding account', async () => {
    stubProvider((url) => {
      if (url.endsWith('/accounts')) return jsonResponse(accountsBody);
      return jsonResponse(retrieveBody);
    });
    const { client } = mockSupabase({
      singles: [{ data: ROW, error: null }],
      lists: [{ data: [{ net_kobo: 300000 }], error: null }],
    });

    const snapshot = await getPlanWalletSnapshot(client, CONFIG, SCOPE);

    expect(snapshot).toEqual({
      status: 'ready',
      walletId: 'pvb-wallet-synthetic-001',
      accountNumber: '9000000001',
      accountName: 'SYNTHETIC PLAN WALLET',
      bankName: 'Synthetic Bank',
      balanceKobo: 5000000,
      paidInterestKobo: 300000,
      pendingAccrualKobo: 0,
    });
    vi.unstubAllGlobals();
  });

  it('short-circuits restricted wallets without provider reads', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { client } = mockSupabase({
      singles: [{ data: { ...ROW, status: 'restricted' }, error: null }],
    });

    const snapshot = await getPlanWalletSnapshot(client, CONFIG, SCOPE);

    expect(snapshot.status).toBe('restricted');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
