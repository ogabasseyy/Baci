import { describe, expect, it, vi } from 'vitest';
import z from 'zod';
import {
  PIGGYVEST_API_BASE_URL,
  PiggyvestApiError,
  piggyvestRequest,
} from './client';

const dataSchema = z.object({ id: z.string() });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('piggyvestRequest', () => {
  it('sends bearer auth and parses the envelope data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: true, message: 'ok', data: { id: 'wallet-1' } })
      );
    vi.stubGlobal('fetch', fetchMock);

    const data = await piggyvestRequest(
      { token: 'synthetic-token' },
      dataSchema,
      '/api/v1/wallet/wallet-1'
    );

    expect(data).toEqual({ id: 'wallet-1' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer synthetic-token',
    });
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      `${PIGGYVEST_API_BASE_URL}/api/v1/wallet/wallet-1`
    );
    vi.unstubAllGlobals();
  });

  it('fails closed without a token and never calls the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      piggyvestRequest({ token: '  ' }, dataSchema, '/api/v1/wallet/x')
    ).rejects.toMatchObject({ code: 'PIGGYVEST_AUTH_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('maps credential rejection to an auth error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ status: false }, 401))
    );

    await expect(
      piggyvestRequest({ token: 'synthetic-token' }, dataSchema, '/x')
    ).rejects.toMatchObject({ code: 'PIGGYVEST_AUTH_ERROR', status: 401 });
    vi.unstubAllGlobals();
  });

  it('maps provider status:false to a request error with the provider message', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ status: false, message: 'An error occurred' }, 400)
        )
    );

    await expect(
      piggyvestRequest({ token: 'synthetic-token' }, dataSchema, '/x')
    ).rejects.toMatchObject({
      code: 'PIGGYVEST_REQUEST_ERROR',
      message: 'An error occurred',
    });
    vi.unstubAllGlobals();
  });

  it('rejects unexpected data shapes without leaking the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ status: true, message: 'ok', data: { nope: 1 } })
        )
    );

    const error: unknown = await piggyvestRequest(
      { token: 'synthetic-token' },
      dataSchema,
      '/x'
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PiggyvestApiError);
    expect((error as PiggyvestApiError).message).not.toContain('nope');
    vi.unstubAllGlobals();
  });
});
