import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCartProofEnvironment } from './cart-runtime-env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getCartProofEnvironment', () => {
  it('prefers an explicit cart proof environment', () => {
    vi.stubEnv('CART_PROOF_ENVIRONMENT', 'preview-green');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('NODE_ENV', 'production');

    expect(getCartProofEnvironment()).toBe('preview-green');
  });

  it('falls back through Vercel, Node and development defaults', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('NODE_ENV', 'production');
    expect(getCartProofEnvironment()).toBe('preview');

    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('HOSTNAME', 'vps-staging-1');
    expect(getCartProofEnvironment()).toBe('production:vps-staging-1');

    vi.stubEnv('NODE_ENV', '');
    expect(getCartProofEnvironment()).toBe('development');
  });

  it('fails closed in production without a deployment discriminator', () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('HOSTNAME', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getCartProofEnvironment()).toThrow(
      'CART_PROOF_ENVIRONMENT is required'
    );
  });

  it('binds preview proofs to the unique deployment URL', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_URL', 'baci-git-feature-user.vercel.app');
    vi.stubEnv('NODE_ENV', 'production');
    expect(getCartProofEnvironment()).toBe(
      'preview:baci-git-feature-user.vercel.app'
    );
  });

  it('ignores blank overrides', () => {
    vi.stubEnv('CART_PROOF_ENVIRONMENT', '   ');
    vi.stubEnv('NODE_ENV', 'test');

    expect(getCartProofEnvironment()).toBe('test');
  });
});

it('reads only bounded valid previous signing keys and rejects malformed configuration', async () => {
  const { getCartPreviousSessionSecrets } = await import('./cart-runtime-env');
  const key = 'fixture-previous-cart-signing-material-0001';
  const entry = { retireAt: '2026-10-22T00:00:00Z', secret: key };
  vi.stubEnv('CART_SESSION_PREVIOUS_SECRETS', JSON.stringify([entry]));
  expect(getCartPreviousSessionSecrets()).toEqual([entry]);
  for (const invalid of [
    'bad-json',
    '{}',
    '[1]',
    // A bare key carries no retirement bound and is never accepted.
    JSON.stringify([key]),
    JSON.stringify([{ secret: key }]),
    JSON.stringify([{ retireAt: 'not-a-date', secret: key }]),
    JSON.stringify([{ retireAt: '2026-10-22T00:00:00Z', secret: 'short' }]),
    JSON.stringify(Array(9).fill(entry)),
  ]) {
    vi.stubEnv('CART_SESSION_PREVIOUS_SECRETS', invalid);
    expect(getCartPreviousSessionSecrets()).toEqual([]);
  }
  // One malformed entry must not discard the still-valid retired keys.
  vi.stubEnv(
    'CART_SESSION_PREVIOUS_SECRETS',
    JSON.stringify([{ secret: 'short' }, entry, 'noise'])
  );
  expect(getCartPreviousSessionSecrets()).toEqual([entry]);
});

it('bounds long preview deployment identifiers without sharing deployment identity', () => {
  vi.stubEnv('CART_PROOF_ENVIRONMENT', '');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('VERCEL_URL', `baci-${'feature'.repeat(15)}-one.vercel.app`);
  const first = getCartProofEnvironment();
  expect(first.length).toBeLessThanOrEqual(64);
  expect(getCartProofEnvironment()).toBe(first);
  vi.stubEnv('VERCEL_URL', `baci-${'feature'.repeat(15)}-two.vercel.app`);
  expect(getCartProofEnvironment()).not.toBe(first);
});

it('bounds explicit environment overrides deterministically without collisions', () => {
  vi.stubEnv('CART_PROOF_ENVIRONMENT', 'a'.repeat(65));
  const first = getCartProofEnvironment();
  expect(first.length).toBeLessThanOrEqual(64);
  expect(getCartProofEnvironment()).toBe(first);
  vi.stubEnv('CART_PROOF_ENVIRONMENT', `${'a'.repeat(64)}b`);
  expect(getCartProofEnvironment()).not.toBe(first);
});

it('issues verifiable proofs with a long explicit override and rejects another override', async () => {
  const { issueCartSessionProof, verifyCartSessionProof } = await import(
    './session-proof'
  );
  vi.stubEnv('CART_PROOF_ENVIRONMENT', 'first-environment-'.repeat(8));
  const secret = 'fixture-environment-proof-secret-at-least-32';
  const now = new Date('2026-10-15T12:00:00Z');
  const proof = issueCartSessionProof(
    {
      scope: 'session',
      merchantId: '11111111-1111-4111-8111-111111111111',
      cartId: '22222222-2222-4222-8222-222222222222',
      grantId: '33333333-3333-4333-8333-333333333333',
      principalId: 'guest-fixture',
    },
    { secret, environment: getCartProofEnvironment(), now }
  );
  expect(
    verifyCartSessionProof(proof, {
      secret,
      environment: getCartProofEnvironment(),
      now,
    }).ok
  ).toBe(true);
  vi.stubEnv('CART_PROOF_ENVIRONMENT', 'second-environment-'.repeat(8));
  expect(
    verifyCartSessionProof(proof, {
      secret,
      environment: getCartProofEnvironment(),
      now,
    }).ok
  ).toBe(false);
});
