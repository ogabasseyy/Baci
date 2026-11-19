import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

const SECRET = 'test-relay-secret-0123456789abcdef0123';
const PV = 'https://api.piggyvest.business';

function relayEnv() {
  vi.stubEnv('PIGGYVEST_EGRESS_RELAY_URL', 'https://pv-egress.example.com');
  vi.stubEnv('PIGGYVEST_EGRESS_RELAY_SECRET', SECRET);
}

function call(
  url: string,
  fetchImplementation: typeof fetch,
  init: RequestInit = { method: 'GET' }
) {
  return requestPrefundedCardProviderJson({
    url,
    token: 'tok',
    timeoutMs: 1000,
    maxResponseBytes: 4096,
    fetchImplementation,
    init,
  });
}

const sent = { 'x-baci-relay-upstream': 'sent' };

afterEach(() => vi.unstubAllEnvs());

describe('requestPrefundedCardProviderJson through the egress relay', () => {
  it('is byte-for-byte direct when the relay is unset', async () => {
    vi.stubEnv('PIGGYVEST_EGRESS_RELAY_URL', '');
    vi.stubEnv('PIGGYVEST_EGRESS_RELAY_SECRET', '');
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: 1 }));
    await call(`${PV}/api/v1/wallet/w1`, fetchMock as unknown as typeof fetch);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PV}/api/v1/wallet/w1`);
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
  });

  it('routes PiggyVest production calls to the relay with a signed header', async () => {
    relayEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ ok: 1 }, { headers: sent }));
    const result = await call(
      `${PV}/api/v1/transfer/wallet`,
      fetchMock as unknown as typeof fetch,
      { method: 'POST', body: '{"amount":5}' }
    );
    expect(result).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://pv-egress.example.com/api/v1/transfer/wallet');
    expect(init.body).toBe('{"amount":5}');
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'x-baci-relay-auth': expect.stringMatching(/^v1\./),
    });
  });

  it('leaves Paystack calls direct', async () => {
    relayEnv();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: 1 }));
    await call(
      'https://api.paystack.co/transaction/verify/r',
      fetchMock as unknown as typeof fetch
    );
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://api.paystack.co/transaction/verify/r'
    );
  });

  it('reads a relay-passed PiggyVest 404 as an HTTP 404, not a relay failure', async () => {
    relayEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('{"status":false}', { status: 404, headers: sent })
      );
    await expect(
      call(
        `${PV}/api/v1/transaction/verify?reference=r&wallet_id=w`,
        fetchMock as unknown as typeof fetch
      )
    ).rejects.toMatchObject({
      message: 'PROVIDER_HTTP_ERROR',
      httpStatus: 404,
    });
  });

  it('maps maybe-sent relay errors to the existing timeout path and never retries', async () => {
    relayEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 504,
        headers: {
          'x-baci-relay-error': 'upstream_timeout',
          'x-baci-relay-upstream': 'maybe-sent',
        },
      })
    );
    await expect(
      call(
        `${PV}/api/v1/transfer/wallet`,
        fetchMock as unknown as typeof fetch,
        {
          method: 'POST',
          body: '{}',
        }
      )
    ).rejects.toThrow('PROVIDER_TIMEOUT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps definite pre-send relay errors to a distinct unavailable error with no HTTP status', async () => {
    relayEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 404,
        headers: {
          'x-baci-relay-error': 'not_allowlisted',
          'x-baci-relay-upstream': 'not-sent',
        },
      })
    );
    const error = await call(
      `${PV}/api/v1/transaction/verify?reference=r&wallet_id=w`,
      fetchMock as unknown as typeof fetch
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ message: 'PROVIDER_RELAY_UNAVAILABLE' });
    expect(error).not.toHaveProperty('httpStatus');
  });

  it('treats a proxy error page without relay markers as indeterminate', async () => {
    relayEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('bad gateway', { status: 502 }));
    await expect(
      call(
        `${PV}/api/v1/transfer/wallet`,
        fetchMock as unknown as typeof fetch,
        { method: 'POST', body: '{}' }
      )
    ).rejects.toThrow('PROVIDER_TIMEOUT');
  });
});
