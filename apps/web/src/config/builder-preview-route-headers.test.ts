import { describe, expect, it } from 'vitest';
import { builderPreviewRouteHeaders } from './builder-preview-route-headers';

describe('builder preview route headers', () => {
  it('marks only the builder preview document private and non-cacheable', () => {
    expect(builderPreviewRouteHeaders).toEqual([
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
