import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnonMerchantFeatureLookup } from '@/lib/cart/request-context';
import { createCartServerTimer } from '@/lib/cart/server-timing';
import { verifyCartSessionProof } from '@/lib/cart/session-proof';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { contextDeps } from './context-deps';

vi.mock('@/lib/cart/cart-runtime-env', () => ({
  getCartProofEnvironment: vi.fn(() => 'test-environment'),
}));
vi.mock('@/lib/cart/request-context', () => ({
  createAnonMerchantFeatureLookup: vi.fn(),
}));
vi.mock('@/lib/cart/session-proof', () => ({
  verifyCartSessionProof: vi.fn(),
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn(),
}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(),
}));

const FEATURES = {
  plan_expires_at: null,
  plan_tier: 'pro',
  premium_features: ['shared_cart'],
};
const lookup = vi.fn();
const rpcClient = { rpc: vi.fn() };
const featureClient = { from: vi.fn() };

describe('cart route context wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookup.mockResolvedValue(FEATURES);
    vi.mocked(createAnonMerchantFeatureLookup).mockReturnValue(lookup);
    vi.mocked(createAnonClient)
      .mockReturnValueOnce(featureClient as never)
      .mockReturnValueOnce(rpcClient as never);
  });

  it('forwards the scope rule and wires merchant resolution', () => {
    const deps = contextDeps('session', 'not_found');

    expect(deps.requireScope).toBe('session');
    expect(deps.wrongScopeError).toBe('not_found');
    expect(deps.merchant.resolveAlias).toBe(getCurrentSlugForAlias);
    expect(deps.merchant.rpcClient).toBe(rpcClient);
    expect(createAnonMerchantFeatureLookup).toHaveBeenCalledWith(featureClient);
    expect(contextDeps('bootstrap', 'forbidden').wrongScopeError).toBe(
      'forbidden'
    );
  });

  it('uses the plain feature lookup when no timer is given', async () => {
    const deps = contextDeps('session', 'not_found');

    expect(deps.merchant.loadMerchantFeatures).toBe(lookup);
    await expect(deps.merchant.loadMerchantFeatures?.('m-1')).resolves.toBe(
      FEATURES
    );
    expect(lookup).toHaveBeenCalledWith('m-1');
  });

  it('reports the feature lookup as a step when a timer is given', async () => {
    const timer = createCartServerTimer();
    const deps = contextDeps('session', 'not_found', timer);

    await expect(deps.merchant.loadMerchantFeatures?.('m-1')).resolves.toBe(
      FEATURES
    );
    expect(lookup).toHaveBeenCalledWith('m-1');
    expect(
      timer.apply(new Response(null)).headers.get('Server-Timing')
    ).toMatch(/^auth-features;dur=[\d.]+, total;dur=[\d.]+$/);
  });

  it('still reports the step, and rethrows, when the lookup fails', async () => {
    const timer = createCartServerTimer();
    lookup.mockRejectedValueOnce(new Error('lookup down'));
    const deps = contextDeps('session', 'not_found', timer);

    await expect(deps.merchant.loadMerchantFeatures?.('m-1')).rejects.toThrow(
      'lookup down'
    );
    expect(
      timer.apply(new Response(null)).headers.get('Server-Timing')
    ).toMatch(/^auth-features;dur=[\d.]+, total;dur=[\d.]+$/);
  });

  it('verifies proofs against the runtime proof environment', () => {
    const verified = { ok: true };
    vi.mocked(verifyCartSessionProof).mockReturnValue(verified as never);
    const deps = contextDeps('session', 'not_found');

    expect(deps.verify('proof-token')).toBe(verified);
    expect(verifyCartSessionProof).toHaveBeenCalledWith('proof-token', {
      environment: 'test-environment',
    });
  });
});
