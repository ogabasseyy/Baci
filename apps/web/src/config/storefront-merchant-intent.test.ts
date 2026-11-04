import { describe, expect, it } from 'vitest';
import {
  MERCHANT_INTENT_CLUSTER_KIND_MAP,
  VALID_MERCHANT_INTENT_SOURCES,
} from './storefront-merchant-intent';

describe('storefront-merchant-intent', () => {
  it('defines valid merchant intent source set', () => {
    expect(VALID_MERCHANT_INTENT_SOURCES.has('merchant_declared')).toBe(true);
    expect(VALID_MERCHANT_INTENT_SOURCES.has('verified_receipt')).toBe(true);
    expect(VALID_MERCHANT_INTENT_SOURCES.has('reviewed')).toBe(true);
    expect(VALID_MERCHANT_INTENT_SOURCES.has('unknown' as never)).toBe(false);
  });

  it('maps comparison, repair-guide, and news to expected cluster kinds', () => {
    expect(MERCHANT_INTENT_CLUSTER_KIND_MAP.comparison).toBe(
      'decision-support'
    );
    expect(MERCHANT_INTENT_CLUSTER_KIND_MAP['repair-guide']).toBe(
      'troubleshooting'
    );
    expect(MERCHANT_INTENT_CLUSTER_KIND_MAP.news).toBeNull();
  });
});
