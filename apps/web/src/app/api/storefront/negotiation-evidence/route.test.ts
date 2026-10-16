// @vitest-environment node

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type NodeCryptoModule = typeof import('node:crypto');

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createScopedClient: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  getSupabaseAgenticJwtPrivateJwk: vi.fn(),
  getSupabaseJwtSecret: vi.fn(() => 'test-supabase-jwt-secret'),
}));

vi.mock('@/env', () => ({
  getSupabaseAgenticJwtPrivateJwk: () =>
    mocks.getSupabaseAgenticJwtPrivateJwk(),
  getSupabaseJwtSecret: () => mocks.getSupabaseJwtSecret(),
}));

vi.mock('server-only', () => ({}));

vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<NodeCryptoModule>()),
  randomUUID: () => 'evidence-uuid',
}));

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@/lib/supabase/scoped', () => ({
  createScopedClient: mocks.createScopedClient,
}));

function createMerchantQuery(result: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn().mockReturnThis(),
  };
}

function createServerMock(options?: {
  merchant?: unknown;
  merchantError?: unknown;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return createMerchantQuery({
          data:
            options && 'merchant' in options
              ? options.merchant
              : { id: MERCHANT_ID },
          error: options?.merchantError ?? null,
        });
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

function createScopedMock() {
  return {
    storage: {
      from: vi.fn(() => ({
        createSignedUploadUrl: mocks.createSignedUploadUrl,
      })),
    },
  };
}

function createRequest(body: unknown) {
  return {
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: vi.fn().mockResolvedValue(body),
    url: 'https://shop.example.com/api/storefront/negotiation-evidence',
  } as unknown as NextRequest;
}

function createInvalidJsonRequest() {
  return {
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: vi.fn().mockRejectedValue(new Error('Bad JSON')),
    url: 'https://shop.example.com/api/storefront/negotiation-evidence',
  } as unknown as NextRequest;
}

describe('POST /api/storefront/negotiation-evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    mocks.getSupabaseAgenticJwtPrivateJwk.mockReturnValue(undefined);
    mocks.getSupabaseJwtSecret.mockReturnValue('test-supabase-jwt-secret');
    mocks.createSignedUploadUrl.mockResolvedValue({
      data: {
        path: `${MERCHANT_ID}/1700000000000-evidence-uuid-promo-screenshot.png`,
        signedUrl: 'https://signed.example/upload',
        token: 'upload-token',
      },
      error: null,
    });
    mocks.createClient.mockResolvedValue(createServerMock());
    mocks.createScopedClient.mockReturnValue(createScopedMock());
  });

  it('issues a signed upload token for accepted proof images', async () => {
    const { NEGOTIATION_EVIDENCE_BUCKET, POST } = await import('./route');

    const response = await POST(
      createRequest({
        contentType: 'image/png',
        fileName: 'Promo Screenshot.PNG',
        fileSize: 5,
        merchantId: MERCHANT_ID,
      })
    );
    const body = (await response.json()) as {
      contentType: string;
      evidencePath: string;
      uploadToken: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      contentType: 'image/png',
      evidencePath: `${MERCHANT_ID}/1700000000000-evidence-uuid-promo-screenshot.png`,
      uploadToken: 'upload-token',
    });
    const scoped = mocks.createScopedClient.mock.results[0].value;
    expect(scoped.storage.from).toHaveBeenCalledWith(
      NEGOTIATION_EVIDENCE_BUCKET
    );
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(
      `${MERCHANT_ID}/1700000000000-evidence-uuid-promo-screenshot.png`,
      { upsert: false }
    );
    expect(mocks.getSupabaseJwtSecret).toHaveBeenCalledTimes(1);
  });

  it('issues signed upload tokens with private JWK signing material when configured', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const { privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    mocks.getSupabaseAgenticJwtPrivateJwk.mockReturnValue(
      JSON.stringify({
        ...privateKey.export({ format: 'jwk' }),
        alg: 'ES256',
        kid: 'evidence-upload-key',
      })
    );
    const { POST } = await import('./route');

    const response = await POST(
      createRequest({
        contentType: 'image/png',
        fileName: 'Promo Screenshot.PNG',
        fileSize: 5,
        merchantId: MERCHANT_ID,
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.getSupabaseJwtSecret).not.toHaveBeenCalled();
    const scopedJwt = mocks.createScopedClient.mock.calls[0]?.[0] as string;
    const encodedHeader = scopedJwt.split('.')[0];
    const header = JSON.parse(
      Buffer.from(encodedHeader, 'base64url').toString('utf8')
    );
    const encodedPayload = scopedJwt.split('.')[1];
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    );
    expect(header).toEqual({
      alg: 'ES256',
      kid: 'evidence-upload-key',
      typ: 'JWT',
    });
    expect(payload).toEqual({
      exp: 1_700_000_300,
      iat: 1_700_000_000,
      merchant_id: MERCHANT_ID,
      negotiation_evidence_upload: true,
      role: 'anon',
    });
  });

  it('rejects malformed JSON before validating merchants', async () => {
    const { POST } = await import('./route');

    const response = await POST(createInvalidJsonRequest());
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid evidence upload request.');
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createScopedClient).not.toHaveBeenCalled();
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects invalid merchant id formats before signed upload initialization', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      createRequest({
        contentType: 'image/png',
        fileName: 'proof.png',
        fileSize: 5,
        merchantId: 'merchant-1',
      })
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('Storefront merchant id is invalid.');
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects oversized file names with a field-specific message', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      createRequest({
        contentType: 'image/png',
        fileName: `${'proof'.repeat(70)}.png`,
        fileSize: 5,
        merchantId: MERCHANT_ID,
      })
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('Use a shorter evidence file name.');
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects oversized content types with a field-specific message', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      createRequest({
        contentType: `image/${'png'.repeat(50)}`,
        fileName: 'proof.png',
        fileSize: 5,
        merchantId: MERCHANT_ID,
      })
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('Use a valid evidence content type.');
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects unsupported file types before signed upload initialization', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      createRequest({
        contentType: 'application/pdf',
        fileName: 'proof.pdf',
        fileSize: 5,
        merchantId: MERCHANT_ID,
      })
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('Upload a screenshot or photo.');
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects oversized evidence before signed upload initialization', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      createRequest({
        contentType: 'image/png',
        fileName: 'proof.png',
        fileSize: 10 * 1024 * 1024 + 1,
        merchantId: MERCHANT_ID,
      })
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('Upload a proof image under 10 MB.');
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects upload initialization for unknown merchant folders', async () => {
    mocks.createClient.mockResolvedValueOnce(
      createServerMock({ merchant: null })
    );
    const { POST } = await import('./route');

    const response = await POST(
      createRequest({
        contentType: 'image/png',
        fileName: 'proof.png',
        fileSize: 5,
        merchantId: MERCHANT_ID,
      })
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Storefront merchant not found.');
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('surfaces signed upload initialization failures', async () => {
    mocks.createSignedUploadUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'RLS denied signed upload' },
    });
    const { POST } = await import('./route');

    const response = await POST(
      createRequest({
        contentType: 'image/png',
        fileName: 'proof.png',
        fileSize: 5,
        merchantId: MERCHANT_ID,
      })
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe('RLS denied signed upload');
  });
});
