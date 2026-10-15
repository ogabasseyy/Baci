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
    expect(getCartProofEnvironment()).toBe('production');

    vi.stubEnv('NODE_ENV', '');
    expect(getCartProofEnvironment()).toBe('development');
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
  vi.stubEnv('CART_SESSION_PREVIOUS_SECRETS', JSON.stringify([key]));
  expect(getCartPreviousSessionSecrets()).toEqual([key]);
  for (const invalid of [
    'bad-json',
    '{}',
    '[1]',
    '["short"]',
    JSON.stringify(Array(9).fill(key)),
  ]) {
    vi.stubEnv('CART_SESSION_PREVIOUS_SECRETS', invalid);
    expect(getCartPreviousSessionSecrets()).toEqual([]);
  }
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
