import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_PROXY_HOST_ROWS } from './storefront-edge-proxy-host-rows';

describe('STOREFRONT_EDGE_PROXY_HOST_ROWS', () => {
  it('keeps host-conditioned classes ahead of path resolution', () => {
    expect(
      STOREFRONT_EDGE_PROXY_HOST_ROWS.every(
        (row) => row.hostCondition?.precedence === 'before_path_decision'
      )
    ).toBe(true);
    expect(
      STOREFRONT_EDGE_PROXY_HOST_ROWS.find(
        ({ id }) => id === 'proxy:custom-domain-platform-route'
      )?.decision
    ).toBe('origin_dynamic');
  });

  it('preserves protected admin routes on custom domains', () => {
    const row = STOREFRONT_EDGE_PROXY_HOST_ROWS.find(
      (candidate) => candidate.id === 'proxy:custom-domain-platform-route'
    );
    expect(row?.pathCondition?.firstSegmentIn).toContain('admin');
    expect(row?.pathCondition?.firstSegmentIn).not.toContain('auth');
  });

  it('keeps merchant-subdomain admin requests dynamic for auth', () => {
    expect(
      STOREFRONT_EDGE_PROXY_HOST_ROWS.find(
        ({ id }) => id === 'proxy:platform-admin'
      )
    ).toEqual(expect.objectContaining({ decision: 'origin_dynamic' }));
  });

  it('models root-domain current-slug redirects with active custom domains', () => {
    const row = STOREFRONT_EDGE_PROXY_HOST_ROWS.find(
      (candidate) => candidate.id === 'proxy:root-domain-current-slug'
    );
    expect(row).toEqual(
      expect.objectContaining({
        decision: 'edge_redirect',
        routePattern: '/{currentSlug}/{*path?}',
        hostCondition: {
          hostKind: 'platform_root_domain',
          precedence: 'before_path_decision',
          requiresActiveCanonicalCustomDomain: true,
        },
      })
    );
  });

  it('redirects platform routes on retired subdomain aliases before storefront paths', () => {
    const row = STOREFRONT_EDGE_PROXY_HOST_ROWS.find(
      ({ id }) => id === 'proxy:retired-host-platform-route'
    );
    expect(row).toEqual(
      expect.objectContaining({
        decision: 'edge_redirect',
        hostCondition: {
          hostKind: 'retired_platform_subdomain_alias',
          precedence: 'before_path_decision',
        },
        pathCondition: expect.objectContaining({
          firstSegmentIn: expect.arrayContaining([
            'login',
            'dashboard',
            'baci-relay',
          ]),
          predicate: 'first_segment_allowlist',
        }),
      })
    );
  });

  it('preserves every platform-root application prefix', () => {
    const row = STOREFRONT_EDGE_PROXY_HOST_ROWS.find(
      ({ id }) => id === 'proxy:platform-route-root'
    );
    expect(row?.pathCondition?.firstSegmentIn).toEqual(
      expect.arrayContaining([
        'forgot-password',
        'reset-password',
        'staff',
        'update-password',
        'verify',
      ])
    );
  });
});
