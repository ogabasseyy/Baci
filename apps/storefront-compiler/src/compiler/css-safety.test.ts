import { describe, expect, it } from 'vitest';
import {
  assertAllowedAssetUrl,
  extractAllCssResourceUrls,
  normalizeCssForInspection,
  validateAndNormalizeMerchantCss,
} from './css-safety';

describe('css-safety', () => {
  it('strips comments, decodes hex escapes, extracts url()/image-set() tokens, and enforces declared assets', () => {
    const norm = normalizeCssForInspection(
      '/* hi */ .a { content: "\\75\\72\\6c"; }'
    );
    expect(norm.unescaped).toContain('url');

    const urls = extractAllCssResourceUrls(
      '.a { background: image-set("/assets/a" 1x, url("/assets/b") 2x); mask: url(#clip); }'
    );
    expect(urls).toContain('/assets/a');
    expect(urls).toContain('/assets/b');
    expect(urls).toContain('#clip');

    const declared = new Set(['a']);
    expect(() =>
      assertAllowedAssetUrl('#clip', 't.css', declared)
    ).not.toThrow();
    expect(() =>
      assertAllowedAssetUrl('/assets/a', 't.css', declared)
    ).not.toThrow();
    expect(() =>
      assertAllowedAssetUrl('/assets/\\61', 't.css', declared)
    ).not.toThrow();
    expect(() =>
      assertAllowedAssetUrl('/assets/missing', 't.css', declared)
    ).toThrow(/Undeclared asset URL/);

    expect(() =>
      validateAndNormalizeMerchantCss(
        '@import "https://evil.example/x.css";',
        'src/a.css',
        declared,
        new Set(['src/a.css'])
      )
    ).toThrow(/External @import URL forbidden/);

    expect(() =>
      validateAndNormalizeMerchantCss(
        '@plugin "bad";',
        'src/a.css',
        declared,
        new Set(['src/a.css'])
      )
    ).toThrow(/Forbidden @plugin/);
  });
});
