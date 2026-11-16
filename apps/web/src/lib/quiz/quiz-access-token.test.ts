import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { verifyQuizAccessToken } from './quiz-access-token';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const SUPABASE_URL = 'https://project.supabase.co';
const USER_ID = '7d3f6a52-1b0e-4c53-9a43-0f6b1f0d2a11';
const KID = 'key-1';

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

let keyPair: KeyPair;
let keyResolver: JWTVerifyGetKey;

async function sign(
  claims: JWTPayload = {},
  {
    alg = 'ES256',
    kid = KID,
    key = keyPair.privateKey,
    expiresIn = '1h',
    issuer = `${SUPABASE_URL}/auth/v1`,
    audience = 'authenticated',
  }: {
    alg?: string;
    kid?: string;
    key?: KeyPair['privateKey'] | Uint8Array;
    expiresIn?: string;
    issuer?: string;
    audience?: string;
  } = {}
) {
  return new SignJWT({ role: 'authenticated', ...claims })
    .setProtectedHeader({ alg, kid })
    .setSubject(USER_ID)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

// A token nobody signed: header and claims, empty signature.
function unsignedToken(header: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode(header)}.${encode({ role: 'authenticated', sub: USER_ID })}.`;
}

function verify(token: string, resolver: JWTVerifyGetKey = keyResolver) {
  return verifyQuizAccessToken(token, {
    keyResolver: resolver,
    supabaseUrl: SUPABASE_URL,
  });
}

describe('verifyQuizAccessToken', () => {
  beforeAll(async () => {
    keyPair = await generateKeyPair('ES256');
    const jwk = await exportJWK(keyPair.publicKey);
    keyResolver = createLocalJWKSet({
      keys: [{ ...jwk, alg: 'ES256', kid: KID, use: 'sig' }],
    });
  });

  it('verifies a valid token and returns the user id', async () => {
    expect(await verify(await sign())).toEqual({
      status: 'verified',
      userId: USER_ID,
    });
  });

  it('tolerates a trailing slash on the Supabase URL', async () => {
    const result = await verifyQuizAccessToken(await sign(), {
      keyResolver,
      supabaseUrl: `${SUPABASE_URL}/`,
    });
    expect(result.status).toBe('verified');
  });

  it('rejects an expired token as invalid', async () => {
    const token = await sign({}, { expiresIn: '-1h' });
    expect(await verify(token)).toEqual({ status: 'invalid' });
  });

  // An unexpected issuer or audience means this deployment's configuration
  // may be off (for example a custom Supabase domain). Supabase Auth decides;
  // a mismatch must never sign every player out.
  it('leaves an unexpected issuer to Supabase Auth and warns once', async () => {
    const token = await sign({}, { issuer: 'https://other.example/auth/v1' });
    expect(await verify(token)).toEqual({ status: 'unverifiable' });
    expect(await verify(token)).toEqual({ status: 'unverifiable' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('repeats the mismatch warning after five minutes', async () => {
    const token = await sign({}, { issuer: 'https://other.example/auth/v1' });
    await verify(token);
    const warningsSoFar = vi.mocked(logger.warn).mock.calls.length;
    const later = Date.now() + 5 * 60_000 + 1;
    const now = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      await verify(token);
      await verify(token);
    } finally {
      now.mockRestore();
    }

    expect(vi.mocked(logger.warn).mock.calls.length).toBe(warningsSoFar + 1);
  });

  it('leaves an unexpected audience to Supabase Auth', async () => {
    const token = await sign({}, { audience: 'service' });
    expect(await verify(token)).toEqual({ status: 'unverifiable' });
  });

  it('rejects a token signed by another key as invalid', async () => {
    const other = await generateKeyPair('ES256');
    const token = await sign({}, { key: other.privateKey });
    expect(await verify(token)).toEqual({ status: 'invalid' });
  });

  it('rejects a missing subject as invalid', async () => {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(keyPair.privateKey);
    expect(await verify(token)).toEqual({ status: 'invalid' });
  });

  it('rejects a non-UUID subject as invalid', async () => {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setSubject('user-1')
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(keyPair.privateKey);
    expect(await verify(token)).toEqual({ status: 'invalid' });
  });

  it('rejects a role other than authenticated as invalid', async () => {
    expect(await verify(await sign({ role: 'anon' }))).toEqual({
      status: 'invalid',
    });
  });

  it('rejects an anonymous-sign-in token as invalid', async () => {
    expect(await verify(await sign({ is_anonymous: true }))).toEqual({
      status: 'invalid',
    });
  });

  it('rejects a malformed token as invalid', async () => {
    expect(await verify('not-a-jwt')).toEqual({ status: 'invalid' });
  });

  it.each([
    'none',
    'None',
    'NONE',
  ])('rejects an unsigned alg=%s token as invalid', async (alg) => {
    expect(await verify(unsignedToken({ alg, typ: 'JWT' }))).toEqual({
      status: 'invalid',
    });
  });

  it('rejects a token that names no algorithm as invalid', async () => {
    expect(await verify(unsignedToken({ typ: 'JWT' }))).toEqual({
      status: 'invalid',
    });
  });

  it('treats a legacy HS256 token as unverifiable', async () => {
    const token = await sign(
      {},
      { alg: 'HS256', key: new TextEncoder().encode('legacy-shared-secret') }
    );
    expect(await verify(token)).toEqual({ status: 'unverifiable' });
  });

  it('treats an unknown key id as unverifiable', async () => {
    const token = await sign({}, { kid: 'rotated-key' });
    expect(await verify(token)).toEqual({ status: 'unverifiable' });
  });

  it('treats a JWKS fetch failure as unverifiable', async () => {
    const failing: JWTVerifyGetKey = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await verify(await sign(), failing)).toEqual({
      status: 'unverifiable',
    });
  });

  it('treats a missing Supabase URL as unverifiable', async () => {
    const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      expect(
        await verifyQuizAccessToken(await sign(), { keyResolver })
      ).toEqual({ status: 'unverifiable' });
    } finally {
      if (previous !== undefined) {
        process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
      }
    }
  });
});
