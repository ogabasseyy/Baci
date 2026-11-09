import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MEDIA_CDN_ORIGIN } from './cdn';
import {
  getReleaseAssetRewriteRules,
  isTypegenProcess,
  RELEASE_ASSET_REWRITE_DESTINATION,
  RELEASE_ASSET_REWRITE_SOURCE,
} from './release-asset-rewrites';

const requireFromHere = createRequire(import.meta.url);
const { convertCustomRouteSource } = requireFromHere(
  'next/dist/server/lib/router-utils/route-types-utils'
) as {
  convertCustomRouteSource: (source: string) => string[];
};

describe('release-asset-rewrites', () => {
  it('excludes the build-time release-asset rewrite from Next.js DynamicRoutes expansion during next build', () => {
    const buildRules = getReleaseAssetRewriteRules([
      '/usr/local/bin/node',
      '/path/to/next',
      'build',
    ]);
    expect(buildRules).toEqual([
      {
        source: RELEASE_ASSET_REWRITE_SOURCE,
        destination: RELEASE_ASSET_REWRITE_DESTINATION,
      },
    ]);
    expect(RELEASE_ASSET_REWRITE_SOURCE).toBe('/release-assets/:path([^/?]+)');
    expect(RELEASE_ASSET_REWRITE_DESTINATION).toBe(
      `${DEFAULT_MEDIA_CDN_ORIGIN}/release-assets/:path`
    );
    expect(RELEASE_ASSET_REWRITE_SOURCE).not.toContain('*');
    expect(convertCustomRouteSource(buildRules[0].source)).toEqual([]);
    expect(convertCustomRouteSource('/release-assets/:path*')).toEqual([
      '/release-assets/[[...path]]',
    ]);
  });

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
        source: RELEASE_ASSET_REWRITE_SOURCE,
        destination: RELEASE_ASSET_REWRITE_DESTINATION,
      },
    ]);
  });

  it('does not treat file paths containing "typegen" as substring as typegen process', () => {
    const argv = [
      'node',
      '/Users/dev/typegen-test/node_modules/.bin/next',
      'start',
    ];
    expect(isTypegenProcess(argv)).toBe(false);
    expect(getReleaseAssetRewriteRules(argv)).toEqual([
      {
        source: RELEASE_ASSET_REWRITE_SOURCE,
        destination: RELEASE_ASSET_REWRITE_DESTINATION,
      },
    ]);
  });
});
