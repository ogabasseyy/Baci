import { describe, expect, it } from 'vitest';
import { doorQuote, merchantShipQuote } from './delivery-quote-test-fixtures.test-support';
import { getDeliveryEstimateLabel } from './get-delivery-estimate-label';

describe('getDeliveryEstimateLabel', () => {
  it('omits the estimate label for the 0-day unknown sentinel', () => {
    expect(getDeliveryEstimateLabel(merchantShipQuote)).toBeNull();
    expect(getDeliveryEstimateLabel(doorQuote)).toBe('3 days');
    expect(
      getDeliveryEstimateLabel({ ...merchantShipQuote, deliveryRange: '2-4 days' }),
    ).toBe('2-4 days');
  });
});
