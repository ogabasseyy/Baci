// These paths use the existing proof-bound scoped cart client, never a
// service-role client. Each route is explicitly listed to exclude siblings.
const cartContext = 'apps/web/src/lib/chatwoot/cart-context.ts';
const cartClient = 'apps/web/src/lib/cart/scoped-client.ts';
const signingMaterial = 'apps/web/src/lib/agentic/jwt-signing-material.ts';
const environment = 'apps/web/src/env.ts';

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
  [cartContext, cartClient, signingMaterial, environment],
] as const;
