import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { parseWalletOnlyCheckoutRequest } from './vtu-wallet-only-request';

const VALID_KEY = '11111111-2222-3333-4444-555555555555';

const VALID_BODY = {
  merchantSlug: 'ogabassey',
  type: 'airtime',
  amount: 1000,
  walletAmount: 1000,
  phoneNumber: '08012345678',
  networkProvider: 'MTN',
};

function makeRequest({
  body = VALID_BODY,
  idempotencyKey = VALID_KEY,
  rawBody,
}: {
  body?: unknown;
  idempotencyKey?: string | null;
  rawBody?: string;
} = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return new NextRequest('http://localhost/api/vtu/checkout/wallet-only', {
    method: 'POST',
    headers,
    body: rawBody ?? JSON.stringify(body),
  });
}

describe('parseWalletOnlyCheckoutRequest', () => {
  it('parses a valid wallet-only request', async () => {
    const result = await parseWalletOnlyCheckoutRequest(makeRequest());

    expect(result).toEqual({
      ok: true,
      idempotencyKey: VALID_KEY,
      input: expect.objectContaining({
        amount: 1000,
        walletAmount: 1000,
        type: 'airtime',
      }),
    });
  });

  it('lowercases the idempotency key for the case-sensitive column', async () => {
    const result = await parseWalletOnlyCheckoutRequest(
      makeRequest({ idempotencyKey: VALID_KEY.toUpperCase() })
    );

    expect(result).toEqual(
      expect.objectContaining({ ok: true, idempotencyKey: VALID_KEY })
    );
  });

  it('rejects a missing idempotency key', async () => {
    const result = await parseWalletOnlyCheckoutRequest(
      makeRequest({ idempotencyKey: null })
    );

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('Idempotency-Key'),
      status: 400,
    });
  });

  it('rejects a non-UUID idempotency key', async () => {
    const result = await parseWalletOnlyCheckoutRequest(
      makeRequest({ idempotencyKey: 'not-a-uuid' })
    );

    expect(result.ok).toBe(false);
  });

  it('rejects malformed JSON without throwing', async () => {
    const result = await parseWalletOnlyCheckoutRequest(
      makeRequest({ rawBody: '{oops' })
    );

    expect(result).toEqual({
      ok: false,
      error: 'Invalid JSON body.',
      status: 400,
    });
  });

  it('rejects schema-invalid payloads with flattened details', async () => {
    const result = await parseWalletOnlyCheckoutRequest(
      makeRequest({ body: { amount: -5 } })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Invalid input');
      expect(result.details).toBeDefined();
    }
  });

  it('rejects partial wallet coverage', async () => {
    const result = await parseWalletOnlyCheckoutRequest(
      makeRequest({ body: { ...VALID_BODY, walletAmount: 400 } })
    );

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('walletAmount === amount'),
      status: 400,
    });
  });
});
