import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestCustomer } from './customers';

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
});
