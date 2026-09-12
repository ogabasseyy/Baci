import { describe, expect, it } from 'vitest';
import { analyticsDeliveryAuthorityManifest as manifest } from './analytics-delivery-authority-manifest';

describe('analytics delivery authority manifest', () => {
  it('records the temporary authority expiry', () => {
    expect(manifest.temporaryAuthorityExpiresAt).toBe(
      '2026-09-16T00:00:00.000Z'
    );
    expect(manifest.queueOnlyDeliveryActivated).toBe(false);
  });

  it('hash-binds the reviewed temporary authority closure', () => {
    expect(manifest.authorityClosureHashes).toEqual({
      'apps/web/src/app/api/analytics/conversion/route.ts':
        '8747272f15477bffc36d4bd8b18fa046338f1dbc6e1234bcd2400e11694057e2',
      'apps/web/src/app/api/events/route.ts':
        '3e758b45f0809b919f1a058251bb1acd85e6df6de93df2b63f45f6766be67aab',
      'apps/web/src/app/api/platform/events/platform-event-forwarding.ts':
        '78fd66f814bdff4621771fad58965bb9fad5e70d6da1012fa0450faf305bacf6',
      'apps/web/src/lib/analytics/fetch-analytics-platform-config.ts':
        '95cc62af2d374bfed4b9b89b5b745e2dbd4c34ada1f3a25cf0c398e3cb376c1e',
      'apps/web/src/lib/analytics/trusted-server-ad-platform-fanout.ts':
        '2f330fb4efcd9cbcbef7a524f43232572082908e4f73e27d72a8cbb8636380b5',
      'apps/web/src/lib/supabase/service.ts':
        '6754dc6f3381be4653abc91e32e65c741172563db570b81c4e820190384f0e05',
    });
  });

  it('records exactly two trusted route importers and the platform helper edge', () => {
    expect(manifest.trustedWrapperImporters).toEqual([
      'apps/web/src/app/api/analytics/conversion/route.ts',
      'apps/web/src/app/api/events/route.ts',
    ]);
    expect(manifest.platformAuthority).toEqual({
      helper:
        'apps/web/src/app/api/platform/events/platform-event-forwarding.ts',
      route: 'apps/web/src/app/api/platform/events/route.ts',
    });
  });

  it('classifies five caller-scoped roots separately from platform settings', () => {
    expect(Object.keys(manifest.callerScopedRouteHashes)).toHaveLength(5);
    expect(
      manifest.callerScopedRouteHashes[
        'apps/web/src/app/api/analytics/ads/route.ts'
      ]
    ).toBe('dc74e421113d3447a816559282bcd0612c49d68d92403cafe5e9cb7001a35e50');
    expect(manifest.platformRouteHash).toEqual({
      path: 'apps/web/src/app/api/platform/events/route.ts',
      sha256:
        'bb3b5ea163f7029bd8a90523ac7944c9e126b2aebc0ce673f82c4e0c48d00161',
    });
  });

  it('freezes the independently verified context authorities', () => {
    expect(manifest.verifiedContextHelperHashes).toEqual({
      'apps/web/src/app/api/analytics/conversion/conversion-route-merchant-context.ts':
        'fd3686f696b06eb137804956af72c35c11e4578e4580c5e992364d4bda143cef',
      'apps/web/src/app/api/events/resolve-legacy-fanout-context.ts':
        '84abded5972fbab0b42db7e5e4321ea67d89b2ebced97b9d6b46d787bfd84967',
      'apps/web/src/lib/events/event-ingress-context.ts':
        'f47e6d124467b7464fbb267c3874f9f5a35ab74b2cad5e3115da67b8df5211ea',
    });
  });
});
