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

  it('ignores blank overrides', () => {
    vi.stubEnv('CART_PROOF_ENVIRONMENT', '   ');
    vi.stubEnv('NODE_ENV', 'test');

    expect(getCartProofEnvironment()).toBe('test');
  });
});
