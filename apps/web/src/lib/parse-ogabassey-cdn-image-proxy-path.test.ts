import { describe, expect, it } from 'vitest';
import { parseOgabasseyCdnImageProxyPath } from './parse-ogabassey-cdn-image-proxy-path';

describe('parseOgabasseyCdnImageProxyPath', () => {
  it('parses valid transform options and core-assets paths while rejecting unknown options or uppercase extensions', () => {
    expect(
      parseOgabasseyCdnImageProxyPath([
        'width=384,quality=70,format=avif',
        'core-assets',
        'products',
        'tecno.avif',
      ])
    ).toEqual({
      assetPath: 'core-assets/products/tecno.avif',
      options: {
        fit: 'inside',
        format: 'avif',
        quality: 70,
        width: 384,
      },
    });

    expect(
      parseOgabasseyCdnImageProxyPath([
        'width=384,quality=70,format=avif,blur=10',
        'core-assets',
        'products',
        'tecno.avif',
      ])
    ).toBeNull();

    expect(
      parseOgabasseyCdnImageProxyPath([
        'width=384,quality=70,format=avif',
        'core-assets',
        'products',
        'phone.JPG',
      ])
    ).toBeNull();
  });
});
