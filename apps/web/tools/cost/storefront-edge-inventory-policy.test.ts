import { describe, expect, it } from 'vitest';
import { STOREFRONT_AGENT_ROUTES } from '../../src/config/storefront-agent-routes';
import { STOREFRONT_FEED_ROUTES } from '../../src/config/storefront-feed-routes';
import { STOREFRONT_EDGE_INVENTORY_POLICY } from './storefront-edge-inventory-policy';

describe('STOREFRONT_EDGE_INVENTORY_POLICY', () => {
  it('keeps row IDs unique and dynamic method families explicit', () => {
    // Arrange
    const rows = STOREFRONT_EDGE_INVENTORY_POLICY.extraRows;

    // Act
    const rowIds = rows.map((row) => row.id);
    const dynamicRows = rows.filter((row) => row.decision === 'origin_dynamic');

    // Assert
    expect(new Set(rowIds).size).toBe(rowIds.length);
    expect(
      dynamicRows
        .filter((row) => row.methods.includes('ANY'))
        .map(({ id }) => id)
    ).toEqual(
      expect.arrayContaining([
        'proxy:api-prefix-passthrough',
        'proxy:mcp-sse-rewrite',
        'proxy:mcp-messages-rewrite',
        'proxy:platform-admin',
        'proxy:platform-route-root',
        'proxy:custom-domain-platform-route',
      ])
    );
    expect(
      dynamicRows.filter((row) => row.methods.includes('ANY'))
    ).toHaveLength(6);
    expect(STOREFRONT_EDGE_INVENTORY_POLICY.apiTerminalRow).toEqual(
      expect.objectContaining({ decision: 'edge_terminal', methods: ['ANY'] })
    );
  });

  it('enumerates storefront agent, feed, and well-known routes before terminal defaults', () => {
    // Arrange
    const rows = STOREFRONT_EDGE_INVENTORY_POLICY.extraRows;
    const patterns = new Map(rows.map((row) => [row.routePattern, row]));

    // Act
    const configuredRoutes = [
      ...Object.values(STOREFRONT_AGENT_ROUTES),
      ...Object.values(STOREFRONT_FEED_ROUTES),
    ];

    // Assert
    for (const routePattern of configuredRoutes) {
      if (routePattern === STOREFRONT_AGENT_ROUTES.agenticApiBase) continue;
      expect(patterns.has(routePattern), `missing ${routePattern}`).toBe(true);
    }
    expect(patterns.get('/.well-known/{*unlisted?}')).toEqual(
      expect.objectContaining({ decision: 'edge_terminal', methods: ['ANY'] })
    );
    expect(patterns.has('/.well-known/{*path}')).toBe(false);
  });

  it('preserves IndexNow and draft-mode requests without opening unknown paths', () => {
    // Arrange
    const rows = STOREFRONT_EDGE_INVENTORY_POLICY.extraRows;

    // Act
    const indexNow = rows.filter((row) =>
      row.id.startsWith('machine:indexnow-key-')
    );
    const draftRows = rows.filter((row) =>
      row.id.startsWith('request-override:draft-mode')
    );

    // Assert
    expect(indexNow).toHaveLength(6);
    expect(indexNow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'machine:indexnow-key-root',
          decision: 'edge_release',
          methods: ['GET', 'HEAD'],
          routePattern: '/0751d5c882ab3d7c013ecbfe9e624d71.txt',
          hostCondition: expect.objectContaining({
            hostKind: 'platform_root_domain',
          }),
        }),
        expect.objectContaining({
          id: 'machine:indexnow-key-custom-domain',
          decision: 'edge_release',
          methods: ['GET', 'HEAD'],
          routePattern: '/0751d5c882ab3d7c013ecbfe9e624d71.txt',
          hostCondition: expect.objectContaining({
            hostKind: 'custom_domain',
          }),
        }),
        expect.objectContaining({
          id: 'machine:indexnow-key-platform-subdomain',
          decision: 'edge_release',
          methods: ['GET', 'HEAD'],
          routePattern: '/0751d5c882ab3d7c013ecbfe9e624d71.txt',
          hostCondition: expect.objectContaining({
            hostKind: 'platform_subdomain',
          }),
        }),
      ])
    );
    expect(draftRows).toHaveLength(4);
    expect(draftRows.every((row) => row.decision === 'origin_dynamic')).toBe(
      true
    );
    expect(
      draftRows.every(
        (row) =>
          row.requestCondition?.precedence === 'before_path_decision' &&
          row.requestCondition.anyCookiePresent?.join(',') ===
            '__next_preview_data,__prerender_bypass'
      )
    ).toBe(true);
    expect(STOREFRONT_EDGE_INVENTORY_POLICY.apiTerminalRow).toEqual(
      expect.objectContaining({ decision: 'edge_terminal', methods: ['ANY'] })
    );
  });

  it('bounds Next support routes and binds machine rows to reviewed sources', () => {
    // Arrange
    const rows = STOREFRONT_EDGE_INVENTORY_POLICY.extraRows;
    const machineRows = rows.filter(
      (row) => row.sourceKind === 'machine_family'
    );
    const byId = new Map(machineRows.map((row) => [row.id, row]));
    const rowById = new Map(rows.map((row) => [row.id, row]));

    // Act and assert
    expect(byId.get('machine:next-image')).toEqual(
      expect.objectContaining({ decision: 'edge_terminal', methods: ['ANY'] })
    );
    expect(rowById.get('proxy:platform-subdomain-next-static')).toBeUndefined();
    expect(byId.get('machine:next-static')).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        requestCondition: {
          pathMembership: 'current_origin_next_build_manifest',
          precedence: 'before_path_decision',
        },
      })
    );
    expect(byId.get('machine:feed-googleMerchantXml')?.methods).toContain(
      'OPTIONS'
    );
    expect(machineRows.every((row) => row.sourcePath)).toBe(true);
  });

  it('applies draft-mode overrides only after proxy host and path classes', () => {
    const rows = STOREFRONT_EDGE_INVENTORY_POLICY.extraRows;
    const draftIndex = rows.findIndex((row) =>
      row.id.startsWith('request-override:draft-mode')
    );
    const lastProxyIndex = rows.reduce(
      (latest, row, index) =>
        row.sourceKind === 'proxy_path_class' ? index : latest,
      -1
    );

    expect(draftIndex).toBeGreaterThan(lastProxyIndex);
  });

  it('applies markdown negotiation only after proxy host and path classes', () => {
    const rows = STOREFRONT_EDGE_INVENTORY_POLICY.extraRows;
    const markdownIndex = rows.findIndex((row) =>
      row.id.startsWith('request-override:markdown-negotiation')
    );
    const lastProxyIndex = rows.reduce(
      (latest, row, index) =>
        row.sourceKind === 'proxy_path_class' ? index : latest,
      -1
    );

    expect(markdownIndex).toBeGreaterThan(lastProxyIndex);
  });

  it('applies server-action overrides only after proxy host and path classes', () => {
    const rows = STOREFRONT_EDGE_INVENTORY_POLICY.extraRows;
    const serverActionIndex = rows.findIndex((row) =>
      row.id.startsWith('server-action:')
    );
    const lastProxyIndex = rows.reduce(
      (latest, row, index) =>
        row.sourceKind === 'proxy_path_class' ? index : latest,
      -1
    );

    expect(serverActionIndex).toBeGreaterThan(lastProxyIndex);
  });

  it('excludes machine rewrite paths from markdown storefront negotiation', () => {
    const row = STOREFRONT_EDGE_INVENTORY_POLICY.extraRows.find(
      ({ id }) => id === 'request-override:markdown-negotiation-storefront'
    );

    expect(row?.pathCondition).toEqual(
      expect.objectContaining({
        firstSegmentNotIn: expect.arrayContaining(['robots.txt', 'api']),
        predicate: 'markdown_negotiation_storefront_excluding_machine',
      })
    );
  });
});
