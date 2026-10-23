import { describe, expect, it } from 'vitest';
import { builderPreviewRouteHeaders } from './builder-preview-route-headers';

describe('builder preview route headers', () => {
  it('marks only the builder preview document private and non-cacheable', () => {
    expect(builderPreviewRouteHeaders).toEqual([
      {
        source: '/builder/approve',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      {
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
        source: '/template-preview/builder-preview',
      },
    ]);
    expect(
      builderPreviewRouteHeaders.some(
        (rule) => rule.source === '/builder-preview'
      )
    ).toBe(false);
  });
});
