import { afterEach, describe, expect, it, vi } from 'vitest';
import z from 'zod';
import {
  PIGGYVEST_API_BASE_URL,
  PiggyvestApiError,
  piggyvestRequest,
} from './client';
import { isDefinitiveNoTransferRejection } from './primary-wallet-savings-transfer';

const SECRET = 'test-relay-secret-0123456789abcdef0123';
const dataSchema = z.object({ id: z.string() });
const okBody = { status: true, message: 'ok', data: { id: 'w1' } };

function relayEnv() {
  vi.stubEnv('PIGGYVEST_EGRESS_RELAY_URL', 'https://pv-egress.example.com');
  vi.stubEnv('PIGGYVEST_EGRESS_RELAY_SECRET', SECRET);
}

function relayError(status: number, code: string, upstream: string) {
  return new Response('{}', {
    status,
    headers: { 'x-baci-relay-error': code, 'x-baci-relay-upstream': upstream },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('piggyvestRequest through the egress relay', () => {
  it('goes direct, with no relay header, when the relay is unset', async () => {
    vi.stubEnv('PIGGYVEST_EGRESS_RELAY_URL', '');
    vi.stubEnv('PIGGYVEST_EGRESS_RELAY_SECRET', '');
    const fetchMock = vi.fn().mockResolvedValue(Response.json(okBody));
    vi.stubGlobal('fetch', fetchMock);

    await piggyvestRequest({ token: 'tok' }, dataSchema, '/api/v1/wallet/w1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PIGGYVEST_API_BASE_URL}/api/v1/wallet/w1`);
    expect(Object.keys(init.headers as object).sort()).toEqual([
      'Authorization',
      'Content-Type',
    ]);
  });

  it('sends production requests to the relay with a signature and the same credentials', async () => {
    relayEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json(okBody, { headers: { 'x-baci-relay-upstream': 'sent' } })
      );
    vi.stubGlobal('fetch', fetchMock);

    const data = await piggyvestRequest(
      { token: 'tok' },
      dataSchema,
      '/api/v1/transfer/wallet',
      { body: { amount: 100 } }
    );

    expect(data).toEqual({ id: 'w1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://pv-egress.example.com/api/v1/transfer/wallet');
    expect(init.body).toBe('{"amount":100}');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'x-baci-relay-auth': expect.stringMatching(
        /^v1\.\d+\.[0-9a-f]{32}\.[0-9a-f]{64}$/
      ),
    });
  });

  it('keeps a sandbox base URL direct even when the relay is set', async () => {
    relayEnv();
    const fetchMock = vi.fn().mockResolvedValue(Response.json(okBody));
    vi.stubGlobal('fetch', fetchMock);

    await piggyvestRequest(
      { token: 'tok', baseUrl: 'https://staging.piggyvest.business' },
      dataSchema,
      '/api/v1/wallet/w1'
    );

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://staging.piggyvest.business/api/v1/wallet/w1'
    );
  });

  it('passes a genuine PiggyVest 401 through as an auth error', async () => {
    relayEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"status":false}', {
          status: 401,
          headers: { 'x-baci-relay-upstream': 'sent' },
        })
      )
    );
    await expect(
      piggyvestRequest({ token: 'tok' }, dataSchema, '/api/v1/wallet/w1')
    ).rejects.toMatchObject({ code: 'PIGGYVEST_AUTH_ERROR', status: 401 });
  });

  it.each([
    ['504 timeout', 504, 'upstream_timeout', 'maybe-sent'],
    ['connection lost', 502, 'upstream_connection_lost', 'maybe-sent'],
    ['unknown marker', 502, 'weird', 'whatever'],
  ])('maps %s to the indeterminate network error', async (_name, status, code, upstream) => {
    relayEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(relayError(status, code, upstream))
    );

    const error = await piggyvestRequest(
      { token: 'tok' },
      dataSchema,
      '/api/v1/transfer/wallet',
      { body: { amount: 1 } }
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PiggyvestApiError);
    expect(error).toMatchObject({
      code: 'PIGGYVEST_NETWORK_ERROR',
      status: null,
      declined: false,
    });
  });

  it.each([
    [401, 'auth_bad_signature'],
    [404, 'not_allowlisted'],
    [503, 'not_configured'],
  ])('maps a definite pre-send relay %s to a non-money-moving unavailable error, never a PiggyVest refusal', async (status, code) => {
    relayEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(relayError(status, code, 'not-sent'))
    );

    const error = await piggyvestRequest(
      { token: 'tok' },
      dataSchema,
      '/api/v1/transfer/wallet',
      { body: { amount: 1 } }
    ).catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: 'PIGGYVEST_RELAY_UNAVAILABLE',
      status: null,
      declined: false,
    });
  });

  it('never retries a mutation after a relay error', async () => {
    relayEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(relayError(504, 'upstream_timeout', 'maybe-sent'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      piggyvestRequest({ token: 'tok' }, dataSchema, '/api/v1/transfer/bank', {
        body: { amount: 1 },
      })
    ).rejects.toBeInstanceOf(PiggyvestApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('relay-proven not-sent failures', () => {
  it('count as a definitive no-transfer rejection (still lookup-gated by the caller)', async () => {
    relayEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(relayError(503, 'overloaded', 'not-sent'))
    );
    const error = await piggyvestRequest(
      { token: 'tok' },
      dataSchema,
      '/api/v1/transfer/wallet',
      { body: { amount: 100 } }
    ).catch((e: unknown) => e);
    expect((error as PiggyvestApiError).code).toBe(
      'PIGGYVEST_RELAY_UNAVAILABLE'
    );
    expect(isDefinitiveNoTransferRejection(error)).toBe(true);
  });

  it('keep an indeterminate relay outcome ambiguous', async () => {
    relayEnv();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(relayError(504, 'upstream_timeout', 'maybe-sent'))
    );
    const error = await piggyvestRequest(
      { token: 'tok' },
      dataSchema,
      '/api/v1/transfer/wallet',
      { body: { amount: 100 } }
    ).catch((e: unknown) => e);
    expect(isDefinitiveNoTransferRejection(error)).toBe(false);
  });
});
