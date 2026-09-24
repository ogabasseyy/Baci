import { describe, expect, it } from 'vitest';
import type { ShippingQuote } from '@/types/shipping-quote';
import { formatShippingDeliveryTime } from './shipping-options-delivery-time';

function buildQuote(overrides: Partial<ShippingQuote> = {}): ShippingQuote {
  return {
    deliveryRange: undefined,
    estimatedDays: 3,
    minDays: undefined,
    maxDays: undefined,
    ...overrides,
  } as ShippingQuote;
}

describe('formatShippingDeliveryTime', () => {
  it('prefers the explicit delivery range', () => {
    expect(
      formatShippingDeliveryTime(
        buildQuote({ deliveryRange: '1-3 working days', estimatedDays: 0 })
      )
    ).toBe('1-3 working days');
  });

  it('renders an unavailable ETA instead of zero days for unset estimates', () => {
    expect(formatShippingDeliveryTime(buildQuote({ estimatedDays: 0 }))).toBe(
      'ETA unavailable'
    );
  });

  it('renders an unavailable ETA for non-finite estimates', () => {
    expect(
      formatShippingDeliveryTime(buildQuote({ estimatedDays: Number.NaN }))
    ).toBe('ETA unavailable');
  });

  it('renders a day range when min and max differ', () => {
    expect(
      formatShippingDeliveryTime(
        buildQuote({ estimatedDays: 3, minDays: 2, maxDays: 5 })
      )
    ).toBe('2-5 days');
  });

  it('singularizes a one-day estimate', () => {
    expect(formatShippingDeliveryTime(buildQuote({ estimatedDays: 1 }))).toBe(
      '1 day'
    );
  });

  it('pluralizes multi-day estimates', () => {
    expect(formatShippingDeliveryTime(buildQuote({ estimatedDays: 3 }))).toBe(
      '3 days'
    );
  });
});
