import { describe, expect, it } from 'vitest';
import { createMockProvider, MOCK_API_KEY } from './mock-provider';

const ORIGIN = 'https://staging.piggyvest.business';
const headers = {
  Authorization: `Bearer ${MOCK_API_KEY}`,
  'Content-Type': 'application/json',
};

interface MockEnvelope {
  status: boolean;
  message: string;
  data: Record<string, unknown>;
}

async function call(
  mock: ReturnType<typeof createMockProvider>,
  method: string,
  path: string,
  body?: unknown
) {
  const response = await mock.fetch(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    json: (await response.json()) as MockEnvelope,
  };
}

const identity = {
  bvn: '00012345678',
  email: 'synthetic+0123456789ab@example.test',
  name: 'Synthetic Customer',
  phone: '+234000123456',
};

describe('mock provider follows the documented sandbox contract', () => {
  it('requires a bearer test key', async () => {
    const mock = createMockProvider();
    const response = await mock.fetch(`${ORIGIN}/api/v1/wallet/x`, {
      headers: { Authorization: 'Bearer nope' },
    });
    expect(response.status).toBe(401);
  });

  it('creates once, then returns the same customer and default wallet with new_customer:false', async () => {
    const mock = createMockProvider();
    const first = await call(
      mock,
      'POST',
      '/api/v1/customers?returnIfExist=true',
      { ...identity, third_party_identifier: 'pvbproof:qa-1' }
    );
    const again = await call(
      mock,
      'POST',
      '/api/v1/customers?returnIfExist=true',
      { ...identity, third_party_identifier: 'pvbproof:qa-1' }
    );
    expect(first.json.data.new_customer).toBe(true);
    expect(again.json.data).toMatchObject({
      new_customer: false,
      wallet_id: first.json.data.wallet_id,
    });
    expect(Object.keys(first.json.data)).toEqual([
      'customer_id',
      'wallet_id',
      'new_customer',
    ]);
  });

  it('settles a wallet transfer only via TSQ and keeps the withdrawal counter unchanged', async () => {
    const mock = createMockProvider();
    const created = (
      await call(mock, 'POST', '/api/v1/customers?returnIfExist=true', identity)
    ).json.data;
    const goal = (
      await call(mock, 'POST', '/api/v1/wallet/sub-account', {
        subaccount_name: 'goal-1',
        customer_id: created.customer_id,
        reserve_virtual_account: true,
      })
    ).json.data;
    await call(mock, 'POST', '/api/v1/transfer/test/funding', {
      wallet_id: created.wallet_id,
      amount: 500_000,
    });
    const sent = await call(mock, 'POST', '/api/v1/transfer/wallet', {
      amount: 100_000,
      source: created.wallet_id,
      destination: goal.id,
      currency: 'NGN',
      reference: 'ref-aaaa-1111',
    });
    expect(sent.status).toBe(202);
    expect(
      (
        await call(
          mock,
          'GET',
          '/api/v1/transaction/verify?reference=ref-aaaa-1111'
        )
      ).json.data.status
    ).toBe('pending');
    expect(
      (
        await call(
          mock,
          'GET',
          '/api/v1/transaction/verify?reference=ref-aaaa-1111'
        )
      ).json.data.status
    ).toBe('success');
    const main = (
      await call(mock, 'GET', `/api/v1/wallet/${created.wallet_id}`)
    ).json.data;
    expect(main.withdrawal_count).toBe(0);
    expect(main.balance).toBe(500_000 - 5_000 - 100_000);
  });

  it('answers 404 for an unknown reference and enforces limit<=100', async () => {
    const mock = createMockProvider();
    const unknown = await call(
      mock,
      'GET',
      '/api/v1/transaction/verify?reference=nope'
    );
    expect(unknown).toMatchObject({
      status: 404,
      json: { status: false, message: 'Transaction not found' },
    });
    expect(
      (await call(mock, 'GET', '/api/v1/transaction?limit=101')).status
    ).toBe(400);
  });

  it('can simulate a dropped connection once, then recover', async () => {
    const mock = createMockProvider({ failNetworkOnce: ['/transfer/wallet'] });
    await expect(
      call(mock, 'POST', '/api/v1/transfer/wallet', {})
    ).rejects.toThrow('fetch failed');
    expect(
      (await call(mock, 'POST', '/api/v1/transfer/wallet', {})).status
    ).toBe(400);
  });

  it('answers a 503 without data by default, and keeps configured data in the failed envelope', async () => {
    const plain = createMockProvider({
      serverErrorPaths: ['/api/v1/wallet/x'],
    });
    const bare = await call(plain, 'GET', '/api/v1/wallet/x');
    expect(bare.status).toBe(503);
    expect(bare.json).toMatchObject({ status: false });
    expect(bare.json.data).toBeUndefined();

    const retaining = createMockProvider({
      serverErrorPaths: ['/api/v1/wallet/x'],
      serverErrorData: { id: 'x', balance: 0, withdrawal_count: 0 },
    });
    const kept = await call(retaining, 'GET', '/api/v1/wallet/x');
    expect(kept.status).toBe(503);
    expect(kept.json).toMatchObject({
      status: false,
      data: { id: 'x', balance: 0, withdrawal_count: 0 },
    });
  });
});

describe('mock provider: flaky paths', () => {
  it('lets `skip` requests through, fails the next `fail` with a 503, then recovers', async () => {
    const mock = createMockProvider({
      flakyPaths: [{ needle: '/api/v1/wallet/x', skip: 1, fail: 2 }],
    });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await call(mock, 'GET', '/api/v1/wallet/x')).status);
    }
    expect(statuses).toEqual([400, 503, 503, 400, 400]);
  });

  it('does not touch other paths or POSTs', async () => {
    const mock = createMockProvider({
      flakyPaths: [{ needle: '/api/v1/wallet/x', skip: 0, fail: 9 }],
    });
    expect((await call(mock, 'GET', '/api/v1/wallet/y')).status).toBe(400);
  });
});

describe('mock provider: every Nth request fails', () => {
  it('fails each Nth matching GET and lets the rest through', async () => {
    const mock = createMockProvider({
      flakyPaths: [{ needle: '/api/v1/wallet/x', skip: 0, fail: 0, every: 3 }],
    });
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push((await call(mock, 'GET', '/api/v1/wallet/x')).status);
    }
    expect(statuses).toEqual([400, 400, 503, 400, 400, 503, 400]);
  });
});
