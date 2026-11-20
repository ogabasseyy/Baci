// These paths use the existing proof-bound scoped cart client, never a
// service-role client. Each route is explicitly listed to exclude siblings.
const cartContext = 'apps/web/src/lib/chatwoot/cart-context.ts';
const cartClient = 'apps/web/src/lib/cart/scoped-client.ts';
const signingMaterial = 'apps/web/src/lib/agentic/jwt-signing-material.ts';
const environment = 'apps/web/src/env.ts';
const commitCartAdd = 'apps/web/src/lib/chatwoot/commit-cart-add.ts';

export const eventPipelineChatwootCartCredentialPaths = [
  [
    'apps/web/src/app/api/storefront/chatwoot/context/authorize/route.ts',
    cartContext,
    cartClient,
    signingMaterial,
    environment,
  ],
  [
    'apps/web/src/app/api/storefront/chatwoot/context/challenge/route.ts',
    cartContext,
    cartClient,
    signingMaterial,
    environment,
  ],
  [
    'apps/web/src/app/api/storefront/chatwoot/context/verify/route.ts',
    cartContext,
    cartClient,
    signingMaterial,
    environment,
  ],
  [
    'apps/web/src/app/api/storefront/chatwoot/context/delivery-options/route.ts',
    cartContext,
    cartClient,
    signingMaterial,
    environment,
  ],
  [
    // Quantity edits call the scoped cart client directly after the same
    // proof-bound Chatwoot session checks as the routes above.
    'apps/web/src/app/api/storefront/chatwoot/cart/quantity/route.ts',
    cartClient,
    signingMaterial,
    environment,
  ],
  [
    // Cart add resolves the Chatwoot session through the shared helper and
    // commits through the scoped cart client (never a service-role client).
    'apps/web/src/app/api/storefront/chatwoot/cart/add/route.ts',
    cartContext,
    cartClient,
    signingMaterial,
    environment,
  ],
  [
    'apps/web/src/app/api/storefront/chatwoot/cart/add/route.ts',
    commitCartAdd,
    cartClient,
    signingMaterial,
    environment,
  ],
  [
    // Product lookups only resolve the Chatwoot session through the shared
    // helper; the catalog read itself uses the anon client.
    'apps/web/src/app/api/storefront/chatwoot/products/route.ts',
    cartContext,
    cartClient,
    signingMaterial,
    environment,
  ],
  [commitCartAdd, cartClient, signingMaterial, environment],
  [cartContext, cartClient, signingMaterial, environment],
] as const;
