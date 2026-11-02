import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPiggyvestCustomer,
  findPiggyvestCustomersByThirdPartyIdentifier,
} from './customers';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

const input = {
  bvn: '00000000000',
  email: 'Customer@Example.com',
  name: 'Synthetic Customer',
  phone: '+2348000000000',
  thirdPartyIdentifier: 'synthetic-customer-001',
};

describe('createPiggyvestCustomer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('explicitly disables accrual for ordinary primary wallets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Created',
        data: {
          customer_id: 'customer-test',
          wallet_id: 'wallet-test',
          new_customer: true,
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    await createPiggyvestCustomer(
      { token: 'test-only-token' },
      {
        ...input,
        enableInterestAccrual: false,
      }
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toHaveProperty(
      'enable_interest_accrual',
      false
    );
  });
  it('sends the interest payout wallet only when one is given', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          status: true,
          message: 'Created',
          data: {
            customer_id: 'customer-test',
            wallet_id: 'wallet-test',
            new_customer: true,
          },
        })
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    await createPiggyvestCustomer(
      { token: 'test-only-token' },
      {
        ...input,
        enableInterestAccrual: true,
        interestPayoutWallet: '01JBZ8Q5W3X9R2K4M6N8P0T2V4',
      }
    );
    await createPiggyvestCustomer(
      { token: 'test-only-token' },
      { ...input, enableInterestAccrual: false }
    );
    const bodies = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String((init as RequestInit).body))
    );
    expect(bodies[0]).toEqual(
      expect.objectContaining({
        enable_interest_accrual: true,
        interest_payout_wallet: '01JBZ8Q5W3X9R2K4M6N8P0T2V4',
      })
    );
    expect(bodies[1]).not.toHaveProperty('interest_payout_wallet');
  });
  it('creates idempotently and returns the default wallet', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Customer created successfully',
        data: {
          customer_id: '905f18f2-858a-4522-9e38-1f5d18bad423',
          wallet_id: '023f843a-be7e-494a-bc5d-9f49f4cc640f',
          new_customer: true,
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createPiggyvestCustomer(
      { token: 'synthetic-token' },
      input
    );

    expect(result).toEqual({
      customer_id: '905f18f2-858a-4522-9e38-1f5d18bad423',
      wallet_id: '023f843a-be7e-494a-bc5d-9f49f4cc640f',
      new_customer: true,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('returnIfExist=true');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.email).toBe('customer@example.com');
    expect(body.third_party_identifier).toBe('synthetic-customer-001');
    vi.unstubAllGlobals();
  });

  it('rejects a malformed BVN before any network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(() =>
      createPiggyvestCustomer(
        { token: 'synthetic-token' },
        { ...input, bvn: '123' }
      )
    ).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('looks customers up by our third_party_identifier with a read-only GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Customers fetched',
        data: {
          paginatedPayload: {
            edges: [
              { id: 'customer-test', third_party_identifier: 'baci:i:c' },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const listing = await findPiggyvestCustomersByThirdPartyIdentifier(
      { token: 'test-only-token' },
      'baci:i:c'
    );
    expect(listing.paginatedPayload.edges).toEqual([
      { id: 'customer-test', third_party_identifier: 'baci:i:c' },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/v1/customers');
    expect(new URL(url).searchParams.get('third_party_identifier')).toBe(
      'baci:i:c'
    );
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.body).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it.each([
    ['an empty', ''],
    ['an oversized', 'x'.repeat(201)],
  ])('refuses %s identifier before any network call', (_label, identifier) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(() =>
      findPiggyvestCustomersByThirdPartyIdentifier(
        { token: 'test-only-token' },
        identifier
      )
    ).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('rejects a listing without its page marker, so it can never read as complete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: true,
          message: 'Customers fetched',
          data: { paginatedPayload: { edges: [] } },
        })
      )
    );
    await expect(
      findPiggyvestCustomersByThirdPartyIdentifier(
        { token: 'test-only-token' },
        'baci:i:c'
      )
    ).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});
