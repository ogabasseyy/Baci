import type { StorefrontReadResult } from '../storefront-read-result';

export const createStorefrontPdpSemanticCooldownResult =
  (): StorefrontReadResult<never> => ({
    status: 'unavailable',
    error: {
      kind: 'timeout',
      operation: 'pdp_semantic_enrichment',
      retryable: true,
    },
  });
