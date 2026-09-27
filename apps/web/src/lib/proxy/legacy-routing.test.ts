import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { runLegacyRoutingStage } from './legacy-routing';

describe('legacy proxy routing', () => {
  it('retires the legacy Klump endpoint as a non-cacheable 410', () => {
    const response = runLegacyRoutingStage(
      new NextRequest('https://usebaci.com/wc-api/klp_wc_payment_webhook'),
      '/wc-api/klp_wc_payment_webhook',
      'usebaci.com',
      'Mozilla'
    );
    expect(response?.status).toBe(410);
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rewrites legacy analytics POST while leaving a GET alone', () => {
    expect(
      runLegacyRoutingStage(
        new NextRequest('https://usebaci.com/analytics/conversion', {
          method: 'POST',
        }),
        '/analytics/conversion',
        'usebaci.com',
        'Mozilla'
      )?.headers.get('x-middleware-rewrite')
    ).toBe('https://usebaci.com/api/analytics/conversion');
    expect(
      runLegacyRoutingStage(
        new NextRequest('https://usebaci.com/analytics/conversion'),
        '/analytics/conversion',
        'usebaci.com',
        'Mozilla'
      )
    ).toBeNull();
  });
});
