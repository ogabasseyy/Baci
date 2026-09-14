import { STOREFRONT_AGENT_ROUTES } from '../../src/config/storefront-agent-routes';
import { STOREFRONT_FEED_ROUTES } from '../../src/config/storefront-feed-routes';
import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { STOREFRONT_EDGE_MACHINE_SOURCE_PATHS } from './storefront-edge-machine-source-paths';
import { createStorefrontEdgeMachineWellKnownRows } from './storefront-edge-machine-well-known-rows';

type InventoryRow = StorefrontEdgeInventory['rows'][number];
type InventoryMethod = InventoryRow['methods'][number];

const METHOD_ORDER: InventoryRow['methods'] = [
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
];

const machineFamily = (
  id: string,
  routePattern: string,
  methods: InventoryRow['methods'],
  decision: InventoryRow['decision'] = 'origin_dynamic'
): InventoryRow => {
  const sourcePath = Object.entries(STOREFRONT_EDGE_MACHINE_SOURCE_PATHS).find(
    ([pattern]) => pattern === routePattern
  )?.[1];
  if (!sourcePath)
    throw new Error(`machine route source is not declared: ${routePattern}`);
  const effectiveMethods: InventoryRow['methods'] =
    decision === 'origin_dynamic' &&
    sourcePath.endsWith('/route.ts') &&
    !methods.includes('ANY')
      ? [...new Set<InventoryMethod>([...methods, 'OPTIONS'])].sort(
          (left, right) =>
            METHOD_ORDER.indexOf(left) - METHOD_ORDER.indexOf(right)
        )
      : methods;
  return {
    decision,
    id,
    methods: effectiveMethods,
    reason: 'explicit_storefront_machine_family',
    routePattern,
    sourceKind: 'machine_family',
    sourcePath,
  };
};

const metadataOptions = (id: string, routePattern: string): InventoryRow => ({
  ...machineFamily(id, routePattern, ['OPTIONS'], 'origin_dynamic'),
  reason: 'automatic_options_response',
});

const indexNowOptions = (
  id: string,
  hostKind: 'platform_root_domain' | 'custom_domain' | 'platform_subdomain'
): InventoryRow => ({
  ...metadataOptions(id, '/0751d5c882ab3d7c013ecbfe9e624d71.txt'),
  hostCondition: { hostKind, precedence: 'before_path_decision' },
});

const FEED_ROWS = Object.entries(STOREFRONT_FEED_ROUTES).map(
  ([name, routePattern]) =>
    machineFamily(`machine:feed-${name}`, routePattern, ['GET', 'HEAD'])
);
export const STOREFRONT_EDGE_MACHINE_ROWS: readonly InventoryRow[] = [
  {
    decision: 'edge_redirect',
    id: 'proxy:retired-slug-machine-path',
    methods: ['GET', 'HEAD'],
    reason: 'retired_storefront_alias_redirect',
    routePattern: '/{*machinePath?}',
    sourceKind: 'proxy_path_class',
    sourcePath: 'apps/web/src/proxy.ts',
    hostCondition: {
      hostKind: 'retired_platform_subdomain_alias',
      precedence: 'before_path_decision',
    },
    pathCondition: {
      firstSegmentNotIn: ['api'],
      precedence: 'before_path_decision',
      predicate: 'retired_alias_storefront_path',
    },
  },
  machineFamily(
    'machine:agent-auth-document',
    STOREFRONT_AGENT_ROUTES.authDoc,
    ['GET', 'HEAD']
  ),
  machineFamily(
    'machine:agent-commerce-manifest',
    STOREFRONT_AGENT_ROUTES.manifest,
    ['GET', 'HEAD']
  ),
  machineFamily('machine:agent-trust-document', STOREFRONT_AGENT_ROUTES.trust, [
    'GET',
    'HEAD',
  ]),
  ...FEED_ROWS,
  machineFamily('machine:next-image', '/_next/image', ['ANY'], 'edge_terminal'),
  {
    ...machineFamily('machine:next-static', '/_next/static/{*asset}', [
      'GET',
      'HEAD',
    ]),
    requestCondition: {
      pathMembership: 'current_origin_next_build_manifest',
      precedence: 'before_path_decision',
    },
  },
  machineFamily(
    'machine:next-unlisted',
    '/_next/{*unlisted?}',
    ['ANY'],
    'edge_terminal'
  ),
  {
    decision: 'edge_redirect',
    id: 'proxy:retired-slug-llms',
    methods: ['GET', 'HEAD'],
    reason: 'retired_storefront_alias_redirect',
    routePattern: '/llms.txt',
    sourceKind: 'proxy_path_class',
    sourcePath: 'apps/web/src/proxy.ts',
    hostCondition: {
      hostKind: 'retired_platform_subdomain_alias',
      precedence: 'before_path_decision',
    },
  },
  machineFamily('machine:llms', '/llms.txt', ['GET', 'HEAD']),
  machineFamily('machine:llms-full', '/llms-full.txt', ['GET', 'HEAD']),
  machineFamily(
    'machine:manifest',
    '/manifest.webmanifest',
    ['GET', 'HEAD'],
    'edge_release'
  ),
  metadataOptions('machine:manifest-options', '/manifest.webmanifest'),
  machineFamily('machine:ads', '/ads.txt', ['GET', 'HEAD'], 'origin_dynamic'),
  machineFamily(
    'machine:app-ads',
    STOREFRONT_AGENT_ROUTES.appAds,
    ['GET', 'HEAD'],
    'origin_dynamic'
  ),
  machineFamily('machine:openapi', STOREFRONT_AGENT_ROUTES.openApi, [
    'GET',
    'HEAD',
  ]),
  {
    ...machineFamily(
      'machine:indexnow-key-root',
      '/0751d5c882ab3d7c013ecbfe9e624d71.txt',
      ['GET', 'HEAD'],
      'edge_release'
    ),
    hostCondition: {
      hostKind: 'platform_root_domain',
      precedence: 'before_path_decision',
    },
  },
  indexNowOptions('machine:indexnow-key-root-options', 'platform_root_domain'),
  {
    ...machineFamily(
      'machine:indexnow-key-custom-domain',
      '/0751d5c882ab3d7c013ecbfe9e624d71.txt',
      ['GET', 'HEAD'],
      'edge_release'
    ),
    hostCondition: {
      hostKind: 'custom_domain',
      precedence: 'before_path_decision',
    },
  },
  indexNowOptions(
    'machine:indexnow-key-custom-domain-options',
    'custom_domain'
  ),
  {
    ...machineFamily(
      'machine:indexnow-key-platform-subdomain',
      '/0751d5c882ab3d7c013ecbfe9e624d71.txt',
      ['GET', 'HEAD'],
      'edge_release'
    ),
    hostCondition: {
      hostKind: 'platform_subdomain',
      precedence: 'before_path_decision',
    },
  },
  indexNowOptions(
    'machine:indexnow-key-platform-subdomain-options',
    'platform_subdomain'
  ),
  {
    ...machineFamily(
      'machine:robots-platform-root-rewrite',
      '/robots.txt',
      ['GET', 'HEAD', 'OPTIONS'],
      'origin_dynamic'
    ),
    hostCondition: {
      hostKind: 'platform_root_domain',
      precedence: 'before_path_decision',
    },
  },
  machineFamily(
    'machine:robots',
    '/robots.txt',
    ['GET', 'HEAD'],
    'edge_release'
  ),
  metadataOptions('machine:robots-options', '/robots.txt'),
  ...createStorefrontEdgeMachineWellKnownRows(machineFamily),
];
