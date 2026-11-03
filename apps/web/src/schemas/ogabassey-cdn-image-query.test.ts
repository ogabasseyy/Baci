import { describe, expect, it } from 'vitest';
import { ogabasseyCdnImageProxySearchParamsSchema } from './ogabassey-cdn-image-query';

describe('ogabasseyCdnImageProxySearchParamsSchema', () => {
  it('allowlists only a bounded v query parameter', () => {
    expect(ogabasseyCdnImageProxySearchParamsSchema.safeParse({}).success).toBe(
      true
    );
    expect(
      ogabasseyCdnImageProxySearchParamsSchema.safeParse({ v: '20260927' })
        .success
    ).toBe(true);
    expect(
      ogabasseyCdnImageProxySearchParamsSchema.safeParse({ bust: '1' }).success
    ).toBe(false);
  });
});
