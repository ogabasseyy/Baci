import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cachedFeatures: vi.fn().mockResolvedValue({}),
  cachedRpcClient: { rpc: vi.fn() },
  getCurrentSlugForAlias: vi.fn(),
  verifyCartSessionProof: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: mocks.getCurrentSlugForAlias,
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(() => ({})),
}));

vi.mock('./cart-runtime-env', () => ({
  getCartProofEnvironment: vi.fn(() => 'test-env'),
}));

vi.mock('./request-context', () => ({
  cachedCartMerchantLookups: vi.fn(() => ({
    features: mocks.cachedFeatures,
    rpcClient: mocks.cachedRpcClient,
  })),
}));

vi.mock('./session-proof', () => ({
  verifyCartSessionProof: mocks.verifyCartSessionProof,
}));

import { createCartRouteContextDeps } from './default-context-deps';
import { createCartServerTimer } from './server-timing';

describe('createCartRouteContextDeps', () => {
  it('wires merchant lookups, timer measurement, and session proof verification', async () => {
    const timer = createCartServerTimer();
    const measureSpy = vi.spyOn(timer, 'measure');

    const deps = createCartRouteContextDeps('session', 'not_found', timer);
    expect(deps.requireScope).toBe('session');
    expect(deps.wrongScopeError).toBe('not_found');
    expect(deps.merchant.resolveAlias).toBe(mocks.getCurrentSlugForAlias);
    expect(deps.merchant.rpcClient).toBe(mocks.cachedRpcClient);

    await deps.merchant.loadMerchantFeatures?.('merchant-1');
    expect(measureSpy).toHaveBeenCalledWith(
      'auth-features',
      expect.any(Function)
    );
    expect(mocks.cachedFeatures).toHaveBeenCalledWith('merchant-1');

    await deps.verify('proof-token');
    expect(mocks.verifyCartSessionProof).toHaveBeenCalledWith('proof-token', {
      environment: 'test-env',
    });
  });
});
