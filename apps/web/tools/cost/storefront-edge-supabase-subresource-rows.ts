import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

const PUCK_STOREFRONT_SOURCE =
  'apps/web/src/components/storefront/puck-storefront.tsx';
const BLOG_SNIPPET_SOURCE =
  'apps/web/src/components/storefront/ogabassey/components/BlogSnippet.tsx';
const NEGOTIATION_SOURCE =
  'apps/web/src/components/storefront/ogabassey/components/negotiation-modal-request.ts';
const NEGOTIATION_MODAL_SOURCE =
  'apps/web/src/components/storefront/ogabassey/components/NegotiationModal.tsx';
const OGA_CHECKOUT_SOURCE =
  'apps/web/src/components/storefront/ogabassey/pages/checkout-page.tsx';
const CHECKOUT_IDENTITY_SOURCE =
  'apps/web/src/components/storefront/checkout-identity-modal.tsx';
const CHECKOUT_AUTH_SOURCE =
  'apps/web/src/components/storefront/checkout-auth-modal.tsx';
const OGA_CHECKOUT_IDENTITY_SOURCE =
  'apps/web/src/components/storefront/ogabassey/components/CheckoutIdentityModal.tsx';
const CART_PAGE_WRAPPER_SOURCE =
  'apps/web/src/components/storefront/ogabassey/pages/cart-page-wrapper.tsx';

function supabaseSubresource(
  id: string,
  routePattern: string,
  methods: InventoryRow['methods'],
  sourcePath: string
): InventoryRow {
  return {
    decision: 'origin_dynamic',
    destinationCondition: {
      hostKind: 'configured_supabase_origin',
      precedence: 'before_path_decision',
    },
    id: `automatic-subresource:supabase-${id}`,
    methods,
    reason: 'browser_supabase_query_requires_external_origin',
    routePattern,
    sourceKind: 'automatic_subresource',
    sourcePath,
  };
}

/** Direct browser-to-Supabase requests emitted by released storefront islands. */
export const STOREFRONT_EDGE_SUPABASE_SUBRESOURCE_ROWS: readonly InventoryRow[] =
  [
    supabaseSubresource(
      'page-configs',
      '/rest/v1/page_configs',
      ['GET', 'OPTIONS'],
      PUCK_STOREFRONT_SOURCE
    ),
    supabaseSubresource(
      'blog-post-products',
      '/rest/v1/blog_post_products',
      ['GET', 'OPTIONS'],
      BLOG_SNIPPET_SOURCE
    ),
    supabaseSubresource(
      'products',
      '/rest/v1/products',
      ['GET', 'OPTIONS'],
      BLOG_SNIPPET_SOURCE
    ),
    supabaseSubresource(
      'cart-products',
      '/rest/v1/products',
      ['GET', 'OPTIONS'],
      CART_PAGE_WRAPPER_SOURCE
    ),
    supabaseSubresource(
      'match-blog-to-product',
      '/rest/v1/rpc/match_blog_to_product',
      ['POST', 'OPTIONS'],
      BLOG_SNIPPET_SOURCE
    ),
    supabaseSubresource(
      'blog-posts',
      '/rest/v1/blog_posts',
      ['GET', 'OPTIONS'],
      BLOG_SNIPPET_SOURCE
    ),
    supabaseSubresource(
      'auth-user-negotiation',
      '/auth/v1/user',
      ['GET', 'OPTIONS'],
      NEGOTIATION_SOURCE
    ),
    supabaseSubresource(
      'auth-user-negotiation-modal',
      '/auth/v1/user',
      ['GET', 'OPTIONS'],
      NEGOTIATION_MODAL_SOURCE
    ),
    supabaseSubresource(
      'negotiation-requests',
      '/rest/v1/negotiation_requests',
      ['POST', 'OPTIONS'],
      NEGOTIATION_SOURCE
    ),
    supabaseSubresource(
      'auth-signup',
      '/auth/v1/signup',
      ['POST', 'OPTIONS'],
      OGA_CHECKOUT_SOURCE
    ),
    supabaseSubresource(
      'auth-password-token',
      '/auth/v1/token',
      ['POST', 'OPTIONS'],
      CHECKOUT_IDENTITY_SOURCE
    ),
    supabaseSubresource(
      'auth-password-token-auth-modal',
      '/auth/v1/token',
      ['POST', 'OPTIONS'],
      CHECKOUT_AUTH_SOURCE
    ),
    supabaseSubresource(
      'auth-password-token-ogabassey',
      '/auth/v1/token',
      ['POST', 'OPTIONS'],
      OGA_CHECKOUT_IDENTITY_SOURCE
    ),
  ];
