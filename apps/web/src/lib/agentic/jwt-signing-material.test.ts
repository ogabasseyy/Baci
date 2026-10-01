import { Buffer } from 'node:buffer';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAgenticJwtPrivateJwk: vi.fn(),
  getSupabaseAnonKey: vi.fn(() => 'anon-key'),
  getSupabaseLegacyAnonJwt: vi.fn<() => string | undefined>(() => undefined),
  getSupabaseJwtSecret: vi.fn(() => 'legacy-test-secret'),
  loggerWarn: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/env', () => ({
  getSupabaseAgenticJwtPrivateJwk: () =>
    mocks.getSupabaseAgenticJwtPrivateJwk(),
  getSupabaseAnonKey: () => mocks.getSupabaseAnonKey(),
  getSupabaseLegacyAnonJwt: () => mocks.getSupabaseLegacyAnonJwt(),
  getSupabaseJwtSecret: () => mocks.getSupabaseJwtSecret(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
  },
}));

describe('agentic JWT signing material', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    mocks.getSupabaseAgenticJwtPrivateJwk.mockReturnValue(undefined);
    mocks.getSupabaseAnonKey.mockReturnValue('anon-key');
    mocks.getSupabaseLegacyAnonJwt.mockReturnValue(undefined);
    mocks.getSupabaseJwtSecret.mockReturnValue('legacy-test-secret');
  });

  it('resolves importable Supabase signing keys as usable', async () => {
    mocks.getSupabaseAgenticJwtPrivateJwk.mockReturnValue(
      JSON.stringify(createPrivateJwk())
    );
    const { getAgenticJwtSigningMaterial, hasUsableAgenticJwtSigningMaterial } =
      await import('@/lib/agentic/jwt-signing-material');

    const material = getAgenticJwtSigningMaterial();

    expect(material.type).toBe('private-jwk');
    expect(hasUsableAgenticJwtSigningMaterial()).toBe(true);
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
    expect(mocks.getSupabaseJwtSecret).not.toHaveBeenCalled();
  });

  it('resolves importable Supabase signing keys without alg as usable', async () => {
    const { alg: _alg, ...privateJwkWithoutAlg } = createPrivateJwk();
    mocks.getSupabaseAgenticJwtPrivateJwk.mockReturnValue(
      JSON.stringify(privateJwkWithoutAlg)
    );
    const { getAgenticJwtSigningMaterial, hasUsableAgenticJwtSigningMaterial } =
      await import('@/lib/agentic/jwt-signing-material');

    const material = getAgenticJwtSigningMaterial();

    expect(material.type).toBe('private-jwk');
    expect(hasUsableAgenticJwtSigningMaterial()).toBe(true);
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
    expect(mocks.getSupabaseJwtSecret).not.toHaveBeenCalled();
  });

  it('falls back to the legacy JWT secret when a configured JWK cannot be imported', async () => {
    mocks.getSupabaseAgenticJwtPrivateJwk.mockReturnValue(
      JSON.stringify({
        alg: 'ES256',
        crv: 'P-256',
        d: 'not-importable',
        kid: 'agentic-test-key',
        kty: 'EC',
        x: 'not-importable',
        y: 'not-importable',
      })
    );
    const { getAgenticJwtSigningMaterial, hasUsableAgenticJwtSigningMaterial } =
      await import('@/lib/agentic/jwt-signing-material');

    expect(getAgenticJwtSigningMaterial()).toEqual({
      secret: 'legacy-test-secret',
      type: 'legacy-secret',
    });
    expect(hasUsableAgenticJwtSigningMaterial()).toBe(true);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Invalid JWK'),
        message:
          'Agentic JWT private JWK is invalid; falling back to legacy JWT secret',
      })
    );
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
    expect(mocks.getSupabaseJwtSecret).toHaveBeenCalled();
  });

  it('falls back to the legacy JWT secret only when no JWK is configured', async () => {
    const { getAgenticJwtSigningMaterial, hasUsableAgenticJwtSigningMaterial } =
      await import('@/lib/agentic/jwt-signing-material');

    const material = getAgenticJwtSigningMaterial();

    expect(material).toEqual({
      secret: 'legacy-test-secret',
      type: 'legacy-secret',
    });
    expect(hasUsableAgenticJwtSigningMaterial()).toBe(true);
  });

  it('rejects an unverified legacy secret in production instead of minting HS256', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.getSupabaseJwtSecret.mockReturnValue('revoked-signing-key-id');
    mocks.getSupabaseAnonKey.mockReturnValue(
      createHs256Jwt('actual-legacy-secret')
    );
    const { hasUsableAgenticJwtSigningMaterial } = await import(
      '@/lib/agentic/jwt-signing-material'
    );
    const { signScopedSupabaseJwt } = await import('@/lib/supabase/scoped-jwt');

    expect(() =>
      signScopedSupabaseJwt({ role: 'anon', scope: 'event-ingress' })
    ).toThrow('SUPABASE_AGENTIC_JWT_PRIVATE_JWK is required in production');
    expect(hasUsableAgenticJwtSigningMaterial()).toBe(false);
  });

  it('allows a legacy secret in production when it verifies the anon key', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.getSupabaseJwtSecret.mockReturnValue('actual-legacy-secret');
    mocks.getSupabaseAnonKey.mockReturnValue(
      createHs256Jwt('actual-legacy-secret')
    );
    const { getAgenticJwtSigningMaterial } = await import(
      '@/lib/agentic/jwt-signing-material'
    );

    expect(getAgenticJwtSigningMaterial()).toEqual({
      secret: 'actual-legacy-secret',
      type: 'legacy-secret',
    });
  });

  it('verifies a legacy secret against a separate legacy anon JWT when the public key is opaque', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.getSupabaseJwtSecret.mockReturnValue('actual-legacy-secret');
    mocks.getSupabaseAnonKey.mockReturnValue('sb_publishable_opaque-key');
    mocks.getSupabaseLegacyAnonJwt.mockReturnValue(
      createHs256Jwt('actual-legacy-secret')
    );
    const { getAgenticJwtSigningMaterial } = await import(
      '@/lib/agentic/jwt-signing-material'
    );

    expect(getAgenticJwtSigningMaterial()).toEqual({
      secret: 'actual-legacy-secret',
      type: 'legacy-secret',
    });
  });
});

function createPrivateJwk() {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return {
    ...privateKey.export({ format: 'jwk' }),
    alg: 'ES256',
    kid: 'agentic-test-key',
  };
}

function createHs256Jwt(secret: string) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'anon' })).toString(
    'base64url'
  );
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}
