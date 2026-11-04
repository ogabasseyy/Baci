import { describe, expect, it } from 'vitest';
import {
  generateOrderDeliveryExceptionEmail,
  generateOrderDeliveryExceptionText,
} from './order-delivery-exception';

const base = {
  customerName: 'Ada <b>',
  merchantName: 'Shop & Co',
  merchantUrl: 'https://shop.example.com',
  orderNumber: 'A-100',
  trackingUrl: 'https://shop.example.com/track-order?token=t',
};

describe('order delivery exception email', () => {
  it('explains a failed delivery attempt and escapes customer text', () => {
    const html = generateOrderDeliveryExceptionEmail({
      ...base,
      kind: 'failed',
    });
    expect(html).toContain('could not be completed');
    expect(html).toContain('Ada &lt;b&gt;');
    expect(html).not.toContain('Ada <b>');
    expect(html).toContain('track-order?token=t');
  });

  it('explains a returned order', () => {
    const text = generateOrderDeliveryExceptionText({
      ...base,
      kind: 'returned',
    });
    expect(text).toContain('being returned to');
    expect(text).toContain('A-100');
  });

  it('omits the tracking link when none exists', () => {
    const html = generateOrderDeliveryExceptionEmail({
      ...base,
      kind: 'failed',
      trackingUrl: undefined,
    });
    expect(html).not.toContain('Track your order');
  });
});
