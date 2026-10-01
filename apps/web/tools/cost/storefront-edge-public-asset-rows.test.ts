import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_PUBLIC_ASSET_ROWS } from './storefront-edge-public-asset-rows';

describe('STOREFRONT_EDGE_PUBLIC_ASSET_ROWS', () => {
  it('enumerates the public assets referenced by released storefront output', () => {
    // Arrange and act
    const byPattern = new Map(
      STOREFRONT_EDGE_PUBLIC_ASSET_ROWS.map((row) => [row.routePattern, row])
    );

    // Assert
    expect([...byPattern.keys()]).toEqual(
      expect.arrayContaining([
        '/african-santa-head.svg',
        '/apple-touch-icon.png',
        '/baci-verified-favicon.svg',
        '/baci-logo.svg',
        '/baci-logo-dark.svg',
        '/logo.png',
        '/badges/app-store-black.svg',
        '/badges/google-play.svg',
        '/android-chrome-192x192.png',
        '/android-chrome-512x512.png',
        '/android-chrome-192x192-maskable.png',
        '/android-chrome-512x512-maskable.png',
        '/favicon-16x16.png',
        '/favicon-32x32.png',
        '/manifest.json',
        '/placeholder.png',
        '/placeholder.svg',
        '/template-previews/ogabassey-v2.png',
      ])
    );
    expect(STOREFRONT_EDGE_PUBLIC_ASSET_ROWS).toHaveLength(18);
    expect(byPattern.size).toBe(STOREFRONT_EDGE_PUBLIC_ASSET_ROWS.length);
    expect(
      STOREFRONT_EDGE_PUBLIC_ASSET_ROWS.every(
        (row) =>
          row.decision === 'edge_release' &&
          row.methods.join(',') === 'GET,HEAD' &&
          row.sourceKind === 'public_asset' &&
          row.sourcePath?.startsWith('apps/web/public/')
      )
    ).toBe(true);
  });
});
