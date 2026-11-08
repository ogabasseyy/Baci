import { DEFAULT_MEDIA_CDN_ORIGIN } from './cdn';

export function isTypegenProcess(
  argv: readonly string[] = process.argv
): boolean {
  return argv.some((arg) => arg.includes('typegen'));
}

/**
 * Rewrite rules for public release assets (storefront images, blog assets).
 *
 * During Next.js type generation (`next typegen`), returning catch-all wildcard
 * rewrites pushes Next.js's internal RouteImpl union over TypeScript's recursion
 * depth limit (TS2589) in storefront components that consume dynamic routes.
 * At runtime and during test assertions, the rewrite routes `/release-assets/:path*`
 * to the default media CDN origin.
 */
export function getReleaseAssetRewriteRules(
  argv: readonly string[] = process.argv
) {
  if (isTypegenProcess(argv)) {
    return [];
  }
  return [
    {
      source: '/release-assets/:path*',
      destination: `${DEFAULT_MEDIA_CDN_ORIGIN}/release-assets/:path*`,
    },
  ];
}
