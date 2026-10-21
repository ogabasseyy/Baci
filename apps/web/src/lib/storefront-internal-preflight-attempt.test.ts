import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureServerException: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/posthog/server', () => ({
  captureServerException: mocks.captureServerException,
}));

import { storefrontInternalPreflight } from './storefront-internal-preflight';

const CONTEXT = {
  surface: 'product-slug' as const,
  identifier: 'ogabassey.com',
  slug: 'missing-product',
};

describe('storefrontInternalPreflight attempt telemetry', () => {
  beforeEach(() => {
    mocks.captureServerException.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('forwards RPC attempt telemetry with a fail-open exception', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');

    await expect(
      storefrontInternalPreflight.captureFailOpen({
        ...CONTEXT,
        attemptId: 'b2db3763-0bca-4bfb-b7eb-c53041ad9a45',
        deadlineMs: 4_000,
        elapsedMs: 4_023,
        outcome: 'client-timeout',
        reason: 'timeout',
        rpcName: 'get_storefront_pdp_preflight',
      })
    ).resolves.toBe(true);

    expect(mocks.captureServerException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        attempt_id: 'b2db3763-0bca-4bfb-b7eb-c53041ad9a45',
        deadline_ms: 4_000,
        elapsed_ms: 4_023,
        outcome: 'client-timeout',
        rpc_name: 'get_storefront_pdp_preflight',
      })
    );
  });
});
