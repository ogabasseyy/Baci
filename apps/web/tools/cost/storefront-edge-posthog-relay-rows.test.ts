import { describe, expect, it } from 'vitest';
import { createStorefrontEdgePosthogRelayRows } from './storefront-edge-posthog-relay-rows';

describe('createStorefrontEdgePosthogRelayRows', () => {
  it('includes the normalized configured relay root and descendants', () => {
    // Arrange and act
    const rows = createStorefrontEdgePosthogRelayRows(' baci-observe/ ');

    // Assert
    const originRows = rows.filter(
      ({ decision }) => decision === 'origin_dynamic'
    );
    expect(originRows.map(({ routePattern }) => routePattern)).toEqual([
      '/baci-observe',
      '/baci-observe/{*path?}',
    ]);
    expect(originRows.map(({ methods }) => methods)).toEqual([
      ['ANY'],
      ['ANY'],
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.routePattern).toBe('/baci-observe/{*path?}');
    expect(rows.every(({ decision }) => decision === 'origin_dynamic')).toBe(
      true
    );
  });

  it('uses the reviewed default when the relay path is empty', () => {
    // Arrange and act
    const rows = createStorefrontEdgePosthogRelayRows('  ');

    // Assert
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision: 'origin_dynamic',
          routePattern: '/baci-relay',
        }),
      ])
    );
  });

  it.each([
    '/api',
    '/api/relay',
  ])('uses the live default for reserved relay path %s', (configuredPath) => {
    const rows = createStorefrontEdgePosthogRelayRows(configuredPath);
    expect(rows[0]?.routePattern).toBe('/baci-relay');
  });

  it('keeps the live normalizer syntax for non-reserved paths', () => {
    const rows = createStorefrontEdgePosthogRelayRows('/Baci-Relay');
    expect(rows[0]?.routePattern).toBe('/Baci-Relay');
  });
});
