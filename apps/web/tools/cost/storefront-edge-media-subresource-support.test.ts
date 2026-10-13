import { describe, expect, it } from 'vitest';
import { mediaSubresource } from './storefront-edge-media-subresource-support';

describe('mediaSubresource', () => {
  it('creates a row with the default CDN source and GET/HEAD methods', () => {
    const row = mediaSubresource('media-cdn', 'configured_media_cdn_origin');

    expect(row).toEqual({
      decision: 'origin_dynamic',
      destinationCondition: {
        hostKind: 'configured_media_cdn_origin',
        precedence: 'before_path_decision',
      },
      id: 'automatic-subresource:media-cdn',
      methods: ['GET', 'HEAD'],
      reason: 'browser_external_media_request',
      routePattern: '/{*externalMediaPath?}',
      sourceKind: 'automatic_subresource',
      sourcePath: 'apps/web/src/components/storefront/cdn-format-image.tsx',
    });
  });

  it('accepts a custom source path and methods', () => {
    const row = mediaSubresource(
      'upload',
      'configured_supabase_storage_upload_origin',
      'apps/web/src/components/storefront/ogabassey/components/negotiation-evidence.ts',
      ['PUT', 'OPTIONS']
    );

    expect(row.sourcePath).toBe(
      'apps/web/src/components/storefront/ogabassey/components/negotiation-evidence.ts'
    );
    expect(row.methods).toEqual(['PUT', 'OPTIONS']);
  });
});
