import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontDatabase } from '@/types/storefront-database';
import { readStorefrontPdpSemanticEnrichment } from './storefront-pdp-semantic-enrichment';
import { storefrontPdpSemanticReadCooldown } from './storefront-pdp-semantic-read-cooldown-singleton';

const loggerMocks = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('@/lib/logger', () => ({ logger: loggerMocks }));

const clusterRequest = {
  p_category_slug: 'smartphones',
  p_cluster_rules: [
    {
      rule_order: 0,
      category_slug: 'smartphones',
      category_names: ['smartphones', 'phones'],
      article_tokens: ['phone', 'battery'],
    },
  ],
  p_cluster_rules_json: '[{"rule_order":0}]',
  p_search_query: '"smartphones" OR "samsung"',
};

function createClient(response: unknown) {
  const abortSignal = vi.fn().mockResolvedValue(response);
  const rpc = vi.fn(() => ({ abortSignal }));
  return {
    client: { rpc } as unknown as SupabaseClient<StorefrontDatabase>,
    rpc,
  };
}

describe('readStorefrontPdpSemanticEnrichment RPC boundary traces', () => {
  beforeEach(() => {
    loggerMocks.warn.mockClear();
    storefrontPdpSemanticReadCooldown.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('traces database timeout responses with their HTTP status', async () => {
    const responseStatus = 500;
    const { client } = createClient({
      data: null,
      error: { code: '57014', message: 'statement timeout' },
      status: responseStatus,
    });

    await expect(
      readStorefrontPdpSemanticEnrichment(client, {
        merchantId: 'merchant-1',
        productId: 'product-1',
        includeGuides: true,
        clusterRequest,
      })
    ).resolves.toEqual({
      status: 'unavailable',
      error: expect.objectContaining({
        kind: 'timeout',
        operation: 'pdp_semantic_enrichment',
        retryable: true,
      }),
    });

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Storefront PDP semantic RPC boundary trace',
        operation: 'pdp_semantic_enrichment',
        outcome: 'timeout_response',
        deadlineMs: 5_000,
        timeoutSignalAborted: false,
        errorCode: '57014',
        responseStatus,
      })
    );
  });

  it('skips a repeated retryable read during the merchant cooldown', async () => {
    const { client, rpc } = createClient({
      data: null,
      error: { code: '57014', message: 'statement timeout' },
      status: 500,
    });

    const firstResult = await readStorefrontPdpSemanticEnrichment(client, {
      merchantId: 'merchant-cooldown',
      productId: 'product-1',
      includeGuides: true,
      clusterRequest,
    });
    const secondResult = await readStorefrontPdpSemanticEnrichment(client, {
      merchantId: 'merchant-cooldown',
      productId: 'product-2',
      includeGuides: true,
      clusterRequest,
    });

    expect(firstResult).toEqual({
      status: 'unavailable',
      error: expect.objectContaining({
        kind: 'timeout',
        operation: 'pdp_semantic_enrichment',
        retryable: true,
      }),
    });
    expect(secondResult).toEqual({
      status: 'unavailable',
      error: {
        kind: 'timeout',
        operation: 'pdp_semantic_enrichment',
        retryable: true,
      },
    });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('traces a native client abort without logging merchant or product inputs', async () => {
    const merchantSentinel = 'merchant-sensitive-sentinel';
    const productSentinel = 'product-sensitive-sentinel';
    const timeoutController = new AbortController();
    const timeoutError = new DOMException(
      'The operation timed out',
      'TimeoutError'
    );
    timeoutController.abort(timeoutError);
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const abortSignal = vi.fn().mockRejectedValue(timeoutError);
    const rpc = vi.fn(() => ({ abortSignal }));
    const client = {
      rpc,
    } as unknown as SupabaseClient<StorefrontDatabase>;

    await expect(
      readStorefrontPdpSemanticEnrichment(client, {
        merchantId: merchantSentinel,
        productId: productSentinel,
        includeGuides: true,
        clusterRequest,
      })
    ).rejects.toBe(timeoutError);

    await expect(
      readStorefrontPdpSemanticEnrichment(client, {
        merchantId: merchantSentinel,
        productId: productSentinel,
        includeGuides: true,
        clusterRequest,
      })
    ).resolves.toEqual({
      status: 'unavailable',
      error: {
        kind: 'timeout',
        operation: 'pdp_semantic_enrichment',
        retryable: true,
      },
    });
    expect(rpc).toHaveBeenCalledOnce();

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Storefront PDP semantic RPC boundary trace',
        operation: 'pdp_semantic_enrichment',
        outcome: 'throw',
        deadlineMs: 5_000,
        timeoutSignalAborted: true,
        errorName: 'TimeoutError',
      })
    );
    const serializedWarning = JSON.stringify(
      loggerMocks.warn.mock.calls[0]?.[0]
    );
    expect(serializedWarning).not.toContain(merchantSentinel);
    expect(serializedWarning).not.toContain(productSentinel);
  });

  it('traces the installed PostgREST timeout response shape with an aborted signal', async () => {
    const timeoutController = new AbortController();
    const timeoutError = new DOMException(
      'The operation timed out',
      'TimeoutError'
    );
    timeoutController.abort(timeoutError);
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const { client } = createClient({
      data: null,
      error: timeoutError,
      status: 0,
    });

    await expect(
      readStorefrontPdpSemanticEnrichment(client, {
        merchantId: 'merchant-1',
        productId: 'product-1',
        includeGuides: true,
        clusterRequest,
      })
    ).resolves.toEqual({
      status: 'unavailable',
      error: expect.objectContaining({
        kind: 'timeout',
        operation: 'pdp_semantic_enrichment',
        retryable: true,
      }),
    });

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'timeout_response',
        deadlineMs: 5_000,
        timeoutSignalAborted: true,
      })
    );
  });
});
