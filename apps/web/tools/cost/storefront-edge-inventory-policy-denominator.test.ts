import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_INVENTORY_POLICY } from './storefront-edge-inventory-policy';

describe('storefront edge denominator policy', () => {
  it('defines a closed nonzero eligible denominator', () => {
    expect(STOREFRONT_EDGE_INVENTORY_POLICY.eligibleDenominatorPolicy).toEqual({
      decisions: ['edge_redirect', 'edge_release'],
      methods: ['GET', 'HEAD'],
      scope: 'approved_pilot_hosts_and_complete_browser_automatic_traffic',
      zeroDenominatorVerdict: 'NOT_PROVEN',
    });
  });
});
