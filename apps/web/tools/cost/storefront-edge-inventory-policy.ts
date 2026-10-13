import { STOREFRONT_EDGE_INVENTORY_ROUTING_INPUT_PATHS } from './storefront-edge-inventory-routing-input-paths';
import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { STOREFRONT_EDGE_MACHINE_ROWS } from './storefront-edge-machine-rows';
import { STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ROWS } from './storefront-edge-media-subresource-rows';
import { STOREFRONT_EDGE_PROXY_ROWS } from './storefront-edge-proxy-rows';
import {
  STOREFRONT_EDGE_PLATFORM_ROOT_FAVICON_ROW,
  STOREFRONT_EDGE_PUBLIC_ASSET_ROWS,
} from './storefront-edge-public-asset-rows';
import { STOREFRONT_EDGE_QUERY_DEPENDENT_ROWS } from './storefront-edge-query-dependent-rows';
import { STOREFRONT_EDGE_SUPABASE_SUBRESOURCE_ROWS } from './storefront-edge-supabase-subresource-rows';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

const API_TERMINAL_ROW: InventoryRow = {
  decision: 'edge_terminal',
  id: 'api:unlisted',
  methods: ['ANY'],
  reason: 'closed_api_inventory_default',
  routePattern: '/api/{*unlisted?}',
  sourceKind: 'api_family',
};

const DRAFT_MODE_ROWS: readonly InventoryRow[] = [
  '/blog',
  '/blog/{*path}',
  '/{storefrontIdentifier}/blog',
  '/{storefrontIdentifier}/blog/{*path}',
].map<InventoryRow>((routePattern, index) => {
  const scope = ['root', 'nested', 'slug-root', 'slug-nested'][index];
  if (!scope) throw new Error('draft-mode path has no stable identifier');
  const row = {
    decision: 'origin_dynamic',
    id: `request-override:draft-mode-${scope}`,
    methods: ['GET', 'HEAD'],
    reason: 'next_draft_mode_cookie_requires_origin',
    requestCondition: {
      anyCookiePresent: ['__next_preview_data', '__prerender_bypass'],
      precedence: 'before_path_decision',
    },
    routePattern,
    sourceKind: 'request_override',
    ...(index >= 2
      ? {
          hostCondition: {
            hostKind: 'platform_root_domain' as const,
            precedence: 'before_path_decision' as const,
          },
        }
      : {}),
  } satisfies InventoryRow;
  return row;
});

const ROUTER_DATA_ROWS: readonly InventoryRow[] = [
  {
    decision: 'origin_dynamic',
    id: 'request-override:router-data',
    methods: ['GET', 'HEAD'],
    reason: 'next_router_data_requires_origin',
    requestCondition: {
      anyHeaderMatch: [
        { name: 'rsc', value: '1' },
        { name: 'next-router-prefetch' },
        { name: 'next-router-state-tree' },
      ],
      matchedStorefrontEntrypointDecision: 'edge_release',
      precedence: 'after_entrypoint_resolution_before_decision',
    },
    routePattern: '/{*storefrontPath?}',
    sourceKind: 'request_override',
    sourcePath: 'apps/web/src/lib/storefront-document-navigation.ts',
  },
];

const AUTH_SESSION_ROWS: readonly InventoryRow[] = [
  {
    decision: 'origin_dynamic',
    id: 'request-override:storefront-auth-session',
    methods: ['GET', 'HEAD'],
    reason: 'storefront_auth_session_requires_origin',
    requestCondition: {
      anyOf: [
        { cookiePredicate: 'supabase_auth_session_hint' },
        { anyHeaderMatch: [{ name: 'authorization' }] },
        { anyHeaderMatch: [{ name: 'x-supabase-auth-token' }] },
      ],
      matchedStorefrontEntrypointDecision: 'edge_release',
      precedence: 'after_entrypoint_resolution_before_decision',
    },
    routePattern: '/{*storefrontPath?}',
    sourceKind: 'request_override',
    sourcePath: 'apps/web/src/proxy.ts',
  },
];

const LOCALE_SENSITIVE_ROWS: readonly InventoryRow[] = [
  {
    decision: 'origin_dynamic',
    id: 'request-override:blog-post-accept-language',
    methods: ['GET', 'HEAD'],
    reason: 'blog_post_locale_rendering',
    requestCondition: {
      anyHeaderMatch: [{ name: 'accept-language' }],
      matchedStorefrontEntrypointId:
        'storefront:(blog)/blog/[postSlug]/page.tsx',
      precedence: 'after_entrypoint_resolution_before_decision',
    },
    routePattern: '/blog/{postSlug}',
    sourceKind: 'request_override',
    sourcePath:
      'apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/page.tsx',
  },
  {
    decision: 'origin_dynamic',
    id: 'request-override:blog-post-accept-language-slug-prefixed',
    methods: ['GET', 'HEAD'],
    reason: 'blog_post_locale_rendering',
    requestCondition: {
      anyHeaderMatch: [{ name: 'accept-language' }],
      matchedStorefrontEntrypointId:
        'storefront:(blog)/blog/[postSlug]/page.tsx:slug-prefixed',
      precedence: 'after_entrypoint_resolution_before_decision',
    },
    routePattern: '/{storefrontIdentifier}/blog/{postSlug}',
    sourceKind: 'request_override',
    sourcePath:
      'apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/page.tsx',
  },
];

const MARKDOWN_NEGOTIATION_EXCLUDED_FIRST_SEGMENTS = [
  'auth.md',
  'openapi.json',
  'agent-commerce.json',
  'agent-trust.json',
  'llms.txt',
  'llms-full.txt',
  'robots.txt',
  'api',
  '_next',
  '.well-known',
] as const;

const MARKDOWN_NEGOTIATION_ROWS: readonly InventoryRow[] = [
  {
    decision: 'origin_dynamic',
    id: 'request-override:markdown-negotiation-root',
    methods: ['GET', 'HEAD'],
    reason: 'next_markdown_content_negotiation_rewrite',
    requestCondition: {
      anyHeaderMatch: [{ name: 'accept', value: 'text/markdown' }],
      precedence: 'before_path_decision',
    },
    routePattern: '/',
    sourceKind: 'request_override',
    sourcePath: 'apps/web/next.config.ts',
  },
  {
    decision: 'origin_dynamic',
    id: 'request-override:markdown-negotiation-storefront',
    methods: ['GET', 'HEAD'],
    reason: 'next_markdown_content_negotiation_rewrite',
    requestCondition: {
      anyHeaderMatch: [{ name: 'accept', value: 'text/markdown' }],
      precedence: 'before_path_decision',
    },
    routePattern: '/{storefrontIdentifier}',
    pathCondition: {
      firstSegmentNotIn: [...MARKDOWN_NEGOTIATION_EXCLUDED_FIRST_SEGMENTS],
      precedence: 'before_path_decision',
      predicate: 'markdown_negotiation_storefront_excluding_machine',
    },
    sourceKind: 'request_override',
    sourcePath: 'apps/web/next.config.ts',
  },
];

const SERVER_ACTION_ROWS: readonly InventoryRow[] = [
  {
    decision: 'origin_dynamic',
    id: 'server-action:blog-post-view-count',
    methods: ['POST'],
    reason: 'automatic_blog_view_count',
    requestCondition: {
      anyHeaderMatch: [{ name: 'next-action' }],
      precedence: 'before_path_decision',
    },
    routePattern: '/blog/{postSlug}',
    sourceKind: 'automatic_subresource',
    sourcePath:
      'apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/actions.ts',
  },
  {
    decision: 'origin_dynamic',
    id: 'server-action:blog-post-view-count-slug-prefixed',
    methods: ['POST'],
    reason: 'automatic_blog_view_count',
    requestCondition: {
      anyHeaderMatch: [{ name: 'next-action' }],
      precedence: 'before_path_decision',
    },
    routePattern: '/{storefrontIdentifier}/blog/{postSlug}',
    sourceKind: 'automatic_subresource',
    sourcePath:
      'apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/actions.ts',
  },
  {
    decision: 'origin_dynamic',
    id: 'server-action:repair-booking',
    methods: ['POST'],
    reason: 'explicit_storefront_server_action',
    requestCondition: {
      anyHeaderMatch: [{ name: 'next-action' }],
      precedence: 'before_path_decision',
    },
    routePattern: '/repair',
    sourceKind: 'server_action',
    sourcePath: 'apps/web/src/app/actions/repair.ts',
  },
  {
    decision: 'origin_dynamic',
    id: 'server-action:repair-booking-slug-prefixed',
    methods: ['POST'],
    reason: 'explicit_storefront_server_action',
    requestCondition: {
      anyHeaderMatch: [{ name: 'next-action' }],
      precedence: 'before_path_decision',
    },
    routePattern: '/{storefrontIdentifier}/repair',
    hostCondition: {
      hostKind: 'platform_root_domain',
      precedence: 'before_path_decision',
    },
    sourceKind: 'server_action',
    sourcePath: 'apps/web/src/app/actions/repair.ts',
  },
];

/** Reviewed, provider-independent policy inputs for the Task 1A inventory. */
export const STOREFRONT_EDGE_INVENTORY_POLICY = {
  completeBrowserPathClasses: [
    'automatic_origin_forbidden',
    'automatic_subresource',
    'client_island',
    'cold_document',
    'explicit_user_action',
    'warm_document',
  ],
  eligibleDenominatorPolicy: {
    decisions: ['edge_redirect', 'edge_release'],
    methods: ['GET', 'HEAD'],
    scope: 'approved_pilot_hosts_and_complete_browser_automatic_traffic',
    zeroDenominatorVerdict: 'NOT_PROVEN',
  },
  apiTerminalRow: API_TERMINAL_ROW,
  extraRows: [
    ...ROUTER_DATA_ROWS,
    ...AUTH_SESSION_ROWS,
    ...LOCALE_SENSITIVE_ROWS,
    ...STOREFRONT_EDGE_QUERY_DEPENDENT_ROWS,
    ...STOREFRONT_EDGE_MACHINE_ROWS,
    ...STOREFRONT_EDGE_PUBLIC_ASSET_ROWS,
    ...STOREFRONT_EDGE_SUPABASE_SUBRESOURCE_ROWS,
    ...STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ROWS,
    STOREFRONT_EDGE_PLATFORM_ROOT_FAVICON_ROW,
    ...STOREFRONT_EDGE_PROXY_ROWS,
    ...SERVER_ACTION_ROWS,
    ...MARKDOWN_NEGOTIATION_ROWS,
    ...DRAFT_MODE_ROWS,
  ],
  routingInputPaths: [...STOREFRONT_EDGE_INVENTORY_ROUTING_INPUT_PATHS],
  schemaVersion: 6,
} as const satisfies {
  apiTerminalRow: InventoryRow;
  completeBrowserPathClasses: readonly string[];
  eligibleDenominatorPolicy: StorefrontEdgeInventory['eligibleDenominatorPolicy'];
  extraRows: readonly InventoryRow[];
  routingInputPaths: readonly string[];
  schemaVersion: 6;
};
