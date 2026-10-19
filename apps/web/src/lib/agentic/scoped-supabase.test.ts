import { Buffer } from 'node:buffer';
import {
  generateKeyPairSync,
  verify as verifyWithPublicKey,
} from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAgenticMerchantContextClient,
  createAgenticScopedSupabaseClient,
} from '@/lib/agentic/scoped-supabase';

const mockClient = { from: vi.fn() };
const mockCreateClient = vi.fn(
  (_supabaseUrl: string, _supabaseKey: string, _options: unknown) => mockClient
);
const mockGetSupabaseAgenticJwtPrivateJwk = vi.fn();
const mockGetSupabaseAnonKey = vi.fn(() => 'anon-key');
const mockGetSupabaseJwtSecret = vi.fn(() => 'legacy-test-secret');
const mockGetSupabaseUrl = vi.fn(() => 'https://supabase.example.com');
const mocks = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (supabaseUrl: string, supabaseKey: string, options: unknown) =>
    mockCreateClient(supabaseUrl, supabaseKey, options),
}));

vi.mock('@/env', () => ({
  getSupabaseAgenticJwtPrivateJwk: () => mockGetSupabaseAgenticJwtPrivateJwk(),
  getSupabaseAnonKey: () => mockGetSupabaseAnonKey(),
  getSupabaseJwtSecret: () => mockGetSupabaseJwtSecret(),
  getSupabaseUrl: () => mockGetSupabaseUrl(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
  },
}));

describe('createAgenticScopedSupabaseClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSupabaseAgenticJwtPrivateJwk.mockReturnValue(undefined);
  });

  it('creates an RLS-scoped client with an imported Supabase signing key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const privateJwk = {
      ...privateKey.export({ format: 'jwk' }),
      alg: 'ES256',
      kid: 'agentic-test-key',
    };
    mockGetSupabaseAgenticJwtPrivateJwk.mockReturnValue(
      JSON.stringify(privateJwk)
    );

    const client = createAgenticScopedSupabaseClient({
      merchantId: '00000000-0000-4000-8000-000000000001',
      merchantSlug: 'ogabassey',
      now: new Date('2026-04-30T10:00:00.000Z'),
    });

    expect(client).toBe(mockClient);
    expect(mockGetSupabaseJwtSecret).not.toHaveBeenCalled();
    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://supabase.example.com',
      'anon-key',
      expect.objectContaining({
        global: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(
              /^Bearer [^.]+\.[^.]+\.[^.]+$/
            ),
          }),
        }),
      })
    );

    const authorization = getAuthorizationHeader();
    const { encodedBody, encodedHeader, encodedSignature, header, payload } =
      decodeJwtFromAuthHeader(authorization);

    expect(header).toEqual({
      alg: 'ES256',
      kid: 'agentic-test-key',
      typ: 'JWT',
    });
    expect(payload).toMatchObject({
      agentic_context: 'checkout',
      agentic_merchant_id: '00000000-0000-4000-8000-000000000001',
      agentic_merchant_slug: 'ogabassey',
      exp: 1777543500,
      iat: 1777543200,
      role: 'authenticated',
      sub: '00000000-0000-4000-8000-000000000001',
    });
    expect(
      verifyWithPublicKey(
        'sha256',
        Buffer.from(`${encodedHeader}.${encodedBody}`),
        {
          dsaEncoding: 'ieee-p1363',
          key: publicKey,
        },
        Buffer.from(encodedSignature, 'base64url')
      )
    ).toBe(true);
  });

  it('falls back to the legacy JWT secret when no private signing key is configured', () => {
    createAgenticScopedSupabaseClient({
      merchantId: '00000000-0000-4000-8000-000000000001',
      merchantSlug: 'ogabassey',
      now: new Date('2026-04-30T10:00:00.000Z'),
    });

    expect(mockGetSupabaseJwtSecret).toHaveBeenCalledTimes(1);
    const { header, payload } = decodeJwtFromAuthHeader(
      getAuthorizationHeader()
    );

    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(payload.agentic_merchant_id).toBe(
      '00000000-0000-4000-8000-000000000001'
    );
  });

  it('trims merchant identifiers before signing scoped claims', () => {
    createAgenticScopedSupabaseClient({
      merchantId: '  00000000-0000-4000-8000-000000000001  ',
      merchantSlug: '  ogabassey  ',
      now: new Date('2026-04-30T10:00:00.000Z'),
    });

    const { payload } = decodeJwtFromAuthHeader(getAuthorizationHeader());

    expect(payload).toMatchObject({
      agentic_merchant_id: '00000000-0000-4000-8000-000000000001',
      agentic_merchant_slug: 'ogabassey',
      sub: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('includes a trimmed session claim when a scoped chat session is provided', () => {
    createAgenticScopedSupabaseClient({
      merchantId: '00000000-0000-4000-8000-000000000001',
      merchantSlug: 'ogabassey',
      sessionId: '  session-1  ',
      now: new Date('2026-04-30T10:00:00.000Z'),
    });

    const { payload } = decodeJwtFromAuthHeader(getAuthorizationHeader());

    expect(payload).toMatchObject({
      agentic_merchant_id: '00000000-0000-4000-8000-000000000001',
      agentic_session_id: 'session-1',
    });
  });

  it.each([
    { merchantId: '', merchantSlug: 'ogabassey' },
    { merchantId: '00000000-0000-4000-8000-000000000001', merchantSlug: '' },
    { merchantId: '   ', merchantSlug: 'ogabassey' },
    { merchantId: '00000000-0000-4000-8000-000000000001', merchantSlug: '   ' },
    {
      merchantId: undefined as never,
      merchantSlug: 'ogabassey',
    },
  ])('fails closed when merchant context is missing: %o', ({
    merchantId,
    merchantSlug,
  }) => {
    expect(() =>
      createAgenticScopedSupabaseClient({ merchantId, merchantSlug })
    ).toThrow('Agentic merchant context is required');
  });

  it.each([
    ['invalid JSON', '{bad-json'],
    ['unsupported algorithm', JSON.stringify({ alg: 'RS256', kid: 'key-id' })],
    ['missing key fields', JSON.stringify({ alg: 'ES256', kid: 'key-id' })],
  ])('falls back to the legacy JWT secret and logs when the imported signing key has %s', (_caseName, rawPrivateJwk) => {
    mockGetSupabaseAgenticJwtPrivateJwk.mockReturnValue(rawPrivateJwk);

    createAgenticScopedSupabaseClient({
      merchantId: '00000000-0000-4000-8000-000000000001',
      merchantSlug: 'ogabassey',
    });

    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Agentic JWT private JWK is invalid; falling back to legacy JWT secret',
      })
    );
    expect(mockGetSupabaseJwtSecret).toHaveBeenCalledTimes(1);
    const { header, payload } = decodeJwtFromAuthHeader(
      getAuthorizationHeader()
    );

    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(payload.agentic_merchant_id).toBe(
      '00000000-0000-4000-8000-000000000001'
    );
  });
});

function decodeJwtFromAuthHeader(authorization: string) {
  const [encodedHeader, encodedBody, encodedSignature] = authorization
    .replace('Bearer ', '')
    .split('.');
  return {
    encodedBody,
    encodedHeader,
    encodedSignature,
    header: JSON.parse(
      Buffer.from(encodedHeader, 'base64url').toString('utf8')
    ),
    payload: JSON.parse(Buffer.from(encodedBody, 'base64url').toString('utf8')),
  };
}

function getAuthorizationHeader() {
  const options = mockCreateClient.mock.calls.at(-1)?.[2] as
    | { global?: { headers?: { Authorization?: string } } }
    | undefined;
  const authorization = options?.global?.headers?.Authorization;
  if (!authorization) {
    throw new Error('Missing authorization header');
  }
  return authorization;
}

it('mints only slug-bound merchant-context authority', () => {
  createAgenticMerchantContextClient(
    ' Ogabassey ',
    new Date('2026-10-19T00:00:00Z')
  );
  const options = mockCreateClient.mock.calls.at(-1)?.[2] as {
    global: { headers: { Authorization: string } };
  };
  const payload = JSON.parse(
    Buffer.from(
      options.global.headers.Authorization.split('.')[1],
      'base64url'
    ).toString('utf8')
  );
  expect(payload.role).toBe('agentic_merchant_context');
  expect(payload.agentic_merchant_slug).toBe('ogabassey');
  expect(payload.exp - payload.iat).toBe(300);
  expect(payload.agentic_merchant_id).toBeUndefined();
  expect(() => createAgenticMerchantContextClient(' ')).toThrow();
});
