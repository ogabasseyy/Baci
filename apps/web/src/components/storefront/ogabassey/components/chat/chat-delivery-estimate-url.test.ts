import { describe, expect, it } from 'vitest';
import { getPrivateDeliveryEstimateUrl } from './chat-delivery-estimate-url';

describe('getPrivateDeliveryEstimateUrl', () => {
  it('preserves the domain endpoint', () => {
    expect(getPrivateDeliveryEstimateUrl('domain', 'api')).toBe('/api/chat/delivery-estimate');
  });

  it('builds a path endpoint from a valid slug', () => {
    expect(getPrivateDeliveryEstimateUrl('path', 'winter-store')).toBe('/api/storefront/winter-store/delivery-estimate');
  });

  it('rejects path mode without a valid storefront slug', () => {
    expect(getPrivateDeliveryEstimateUrl('path')).toBeNull();
    expect(getPrivateDeliveryEstimateUrl('path', 'api')).toBeNull();
  });
});
