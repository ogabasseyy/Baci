import { DEFAULT_MEDIA_CDN_ORIGIN } from './cdn';

export function isTypegenProcess(
  argv: readonly string[] = process.argv
): boolean {
  return argv.includes('typegen');
}

/**
 * Custom regex parameter (`[^?]+`) for `/release-assets/:path([^?]+)`.
 *
 * Unlike `:path*` (which Next.js `convertCustomRouteSource` expands into
 * `/release-assets/${OptionalCatchAllSlug<T>}` in `.next/types/link.d.ts`
 * during both `next typegen` and `next build`, pushing `RouteImpl` over
 * TypeScript's recursion depth limit TS2589), a custom character-class regex
 * (`[^?]+`) is skipped by `convertCustomRouteSource` while matching the exact
 * same non-empty release-asset path segments (`/release-assets/<64-hex>.<ext>`)
 * at runtime on Next.js and Vercel. Bare `/release-assets` directory requests
 * are intentionally unhandled because release assets are always addressed by file path.
 */
export const RELEASE_ASSET_REWRITE_SOURCE = '/release-assets/:path([^?]+)';
export const RELEASE_ASSET_REWRITE_DESTINATION = `${DEFAULT_MEDIA_CDN_ORIGIN}/release-assets/:path`;

export function getReleaseAssetRewriteRules(
  argv: readonly string[] = process.argv
) {
  if (isTypegenProcess(argv)) {
    return [];
  }
  return [
    {
      source: RELEASE_ASSET_REWRITE_SOURCE,
      destination: RELEASE_ASSET_REWRITE_DESTINATION,
    },
  ];
}
