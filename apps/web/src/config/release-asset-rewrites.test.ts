import { describe, expect, it } from 'vitest';
import { DEFAULT_MEDIA_CDN_ORIGIN } from './cdn';
import {
  getReleaseAssetRewriteRules,
  isTypegenProcess,
} from './release-asset-rewrites';

describe('release-asset-rewrites', () => {
  it('detects typegen process from argv', () => {
    expect(
      isTypegenProcess(['/usr/local/bin/node', '/path/to/next', 'typegen'])
    ).toBe(true);
    expect(
      isTypegenProcess(['/usr/local/bin/node', '/path/to/next', 'start'])
    ).toBe(false);
    expect(
      isTypegenProcess(['/usr/local/bin/node', '/path/to/next', 'dev'])
    ).toBe(false);
  });

  it('omits release asset rewrite during typegen to avoid route union explosion', () => {
    const rules = getReleaseAssetRewriteRules([
      '/usr/local/bin/node',
      '/path/to/next',
      'typegen',
    ]);
    expect(rules).toEqual([]);
  });

  it('provides the media CDN rewrite for runtime and tests', () => {
    const rules = getReleaseAssetRewriteRules([
      '/usr/local/bin/node',
      '/path/to/next',
      'start',
    ]);
    expect(rules).toEqual([
      {
        source: '/release-assets/:path*',
        destination: `${DEFAULT_MEDIA_CDN_ORIGIN}/release-assets/:path*`,
      },
    ]);
  });
});
