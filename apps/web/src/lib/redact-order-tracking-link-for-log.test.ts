import { describe, expect, it } from 'vitest';
import { redactOrderTrackingLinkForLog } from './redact-order-tracking-link-for-log';

describe('redactOrderTrackingLinkForLog', () => {
  it('redacts the token and email from logged links', () => {
    expect(
      redactOrderTrackingLinkForLog(
        'https://testshop.usebaci.com/track-order?token=track-123'
      )
    ).toBe('https://testshop.usebaci.com/track-order?[redacted]');
    expect(
      redactOrderTrackingLinkForLog(
        'https://testshop.usebaci.com/track-order?order_id=order-123&email=ada%40example.com'
      )
    ).toBe('https://testshop.usebaci.com/track-order?[redacted]');
  });

  it('leaves links without a query string untouched', () => {
    expect(
      redactOrderTrackingLinkForLog('https://testshop.usebaci.com/track-order')
    ).toBe('https://testshop.usebaci.com/track-order');
  });
});
