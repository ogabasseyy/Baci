import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildOrderTrackingLink } from './build-order-tracking-link';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('buildOrderTrackingLink', () => {
  it('prefers the token lookup, which needs no customer email', () => {
    expect(
      buildOrderTrackingLink(
        'https://testshop.usebaci.com',
        { id: 'order-123', tracking_token: 'track-123' },
        'ada@example.com'
      )
    ).toBe('https://testshop.usebaci.com/track-order?token=track-123');
  });

  it('falls back to the order id plus email pair', () => {
    expect(
      buildOrderTrackingLink(
        'https://testshop.usebaci.com',
        { id: 'order-123', tracking_token: null },
        'ada@example.com'
      )
    ).toBe(
      'https://testshop.usebaci.com/track-order?order_id=order-123&email=ada%40example.com'
    );
  });

  it('omits a blank email rather than emitting an unresolvable lookup', () => {
    expect(
      buildOrderTrackingLink(
        'https://testshop.usebaci.com',
        { id: 'order-123' },
        '   '
      )
    ).toBe('https://testshop.usebaci.com/track-order?order_id=order-123');
  });

  it('points at a route that exists in the App Router tree', () => {
    // A CTA href string alone cannot prove customers reach a page: pin the
    // helper's pathname to the checked-in route file so a moved or deleted
    // track-order page fails loudly instead of shipping a 404 email link.
    const link = buildOrderTrackingLink(
      'https://testshop.usebaci.com',
      { id: 'order-123', tracking_token: 'track-123' },
      'ada@example.com'
    );
    expect(new URL(link).pathname).toBe('/track-order');
    expect(
      existsSync(
        resolve(
          srcDir,
          'app/(storefront)/[slug]/(commerce)/track-order/page.tsx'
        )
      )
    ).toBe(true);
  });
});
