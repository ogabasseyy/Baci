import { describe, expect, it } from 'vitest';
import {
  cspAllowlistSchema,
  hostOriginSchema,
  httpsOriginSchema,
  isValidProductRouteParams,
  previewOriginSchema,
} from './origin-schemas';

describe('origin-schemas', () => {
  it('validates bare HTTPS hostname origins and rejects wildcards, ports, paths, credentials, trailing dots, and raw IPs', () => {
    expect(httpsOriginSchema.safeParse('https://cdn.usebaci.com').success).toBe(
      true
    );
    expect(
      httpsOriginSchema.safeParse('https://www.googletagmanager.com').success
    ).toBe(true);

    for (const invalid of [
      'http://cdn.usebaci.com',
      'https://*.evil.example',
      'https://cdn.usebaci.com:8443',
      'https://cdn.usebaci.com/path',
      'https://cdn.usebaci.com?q=1',
      'https://cdn.usebaci.com#frag',
      'https://user:pass@cdn.usebaci.com',
      'https://cdn.usebaci.com.',
      'https://169.254.169.254',
      'https://[::1]',
      'https://localhost',
    ]) {
      expect(httpsOriginSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('validates previewOrigin allowing HTTPS origins and localhost/127.0.0.1 HTTP origins with ports', () => {
    for (const valid of [
      'https://preview.usebaci.com',
      'https://localhost:3000',
      'http://localhost:3000',
      'http://127.0.0.1:8787',
    ]) {
      expect(previewOriginSchema.safeParse(valid).success).toBe(true);
    }

    for (const invalid of [
      'http://preview.usebaci.com',
      'http://192.168.1.10:3000',
      'https://preview.usebaci.com/frame',
      'https://*.usebaci.com',
      'https://preview.usebaci.com.',
    ]) {
      expect(previewOriginSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('validates hostOrigin while blocking platform-reserved apex/API/CDN hosts, ports, wildcards, and IPs', () => {
    expect(
      hostOriginSchema.safeParse('https://shop.ogabassey.com').success
    ).toBe(true);
    expect(
      hostOriginSchema.safeParse('https://ogabassey.usebaci.com').success
    ).toBe(true);

    for (const invalid of [
      'https://usebaci.com',
      'https://api.usebaci.com',
      'https://cdn.usebaci.com',
      'https://shop.ogabassey.com.',
      'https://shop.ogabassey.com:444',
      'http://shop.ogabassey.com',
      'https://1.2.3.4',
    ]) {
      expect(hostOriginSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('enforces cspAllowlistSchema strict keys and 16-origin per-directive caps', () => {
    expect(cspAllowlistSchema.parse(undefined)).toEqual({
      scriptOrigins: [],
      connectOrigins: [],
      imgOrigins: [],
    });
    const seventeen = Array.from(
      { length: 17 },
      (_, i) => `https://h${i}.example.com`
    );
    expect(
      cspAllowlistSchema.safeParse({
        scriptOrigins: seventeen,
        connectOrigins: [],
        imgOrigins: [],
      }).success
    ).toBe(false);
    expect(
      cspAllowlistSchema.safeParse({
        scriptOrigins: [],
        connectOrigins: [],
        imgOrigins: [],
        extraKey: [],
      }).success
    ).toBe(false);
  });

  it('validates product route parameter combinations via isValidProductRouteParams', () => {
    expect(isValidProductRouteParams(['handle'])).toBe(true);
    expect(isValidProductRouteParams(['category', 'productSlug'])).toBe(true);
    expect(isValidProductRouteParams(['categoryId', 'sku', 'variantId'])).toBe(
      true
    );
    expect(isValidProductRouteParams(['productSlug', 'sku'])).toBe(true);

    expect(isValidProductRouteParams([])).toBe(false);
    expect(isValidProductRouteParams(['variantId'])).toBe(false);
    expect(isValidProductRouteParams(['category', 'variant'])).toBe(false);
    expect(isValidProductRouteParams(['unknownQualifier', 'productSlug'])).toBe(
      false
    );
  });
});
