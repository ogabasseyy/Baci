import { expect, it } from 'vitest';
import { rewriteCssAssetUrls } from './rewrite-css-asset-urls';

it('rewrites known root-relative URLs in one pass and preserves others', () => {
  const base = '/published/shop/build';
  const css = `a{background:url('/assets/a')}b{background:url(/assets/a-long)}c{background:url(/assets/unknown)}d{background:url('${base}/assets/a')}`;
  const rewritten = rewriteCssAssetUrls(css, base, ['a', 'a', 'a-long']);
  expect(rewritten).toBe(
    `a{background:url('${base}/assets/a')}b{background:url(${base}/assets/a-long)}c{background:url(/assets/unknown)}d{background:url('${base}/assets/a')}`
  );
  expect(rewriteCssAssetUrls(rewritten, base, ['a', 'a-long'])).toBe(rewritten);
});
