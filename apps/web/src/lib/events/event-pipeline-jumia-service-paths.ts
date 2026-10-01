const client = 'apps/web/src/lib/jumia/client.ts';
const clientConfig = 'apps/web/src/lib/jumia/jumia-client-config.ts';
const loadGrant = 'apps/web/src/lib/jumia/load-jumia-authorization-grant.ts';
const credentialClient = 'apps/web/src/lib/jumia/server-credential-client.ts';

const clientPath = [client, clientConfig, loadGrant, credentialClient] as const;

const clientRoutes = [
  'apps/web/src/app/api/marketplace/jumia/actions/route.ts',
  'apps/web/src/app/api/marketplace/jumia/brands/route.ts',
  'apps/web/src/app/api/marketplace/jumia/categories/route.ts',
  'apps/web/src/app/api/marketplace/jumia/consignment/route.ts',
  'apps/web/src/app/api/marketplace/jumia/orders/[id]/items/route.ts',
  'apps/web/src/app/api/marketplace/jumia/orders/route.ts',
  'apps/web/src/app/api/marketplace/jumia/products/export/route.ts',
  'apps/web/src/app/api/marketplace/jumia/products/feed-status/route.ts',
  'apps/web/src/app/api/marketplace/jumia/products/import/route.ts',
  'apps/web/src/app/api/marketplace/jumia/products/route.ts',
  'apps/web/src/app/api/marketplace/jumia/products/stock/route.ts',
  'apps/web/src/app/api/marketplace/jumia/products/update/route.ts',
] as const;

export const eventPipelineJumiaServicePaths = [
  ...clientRoutes.map((route) => [route, ...clientPath]),
  [
    'apps/web/src/app/api/marketplace/jumia/connect/exchange/route.ts',
    'apps/web/src/app/api/marketplace/jumia/connect/exchange/discover-jumia-oauth-shops.ts',
    ...clientPath,
  ],
  [
    'apps/web/src/app/api/marketplace/jumia/callback/route.ts',
    'apps/web/src/app/api/marketplace/jumia/callback/handler.ts',
    'apps/web/src/app/api/marketplace/jumia/callback/callback-flow.ts',
    'apps/web/src/app/api/marketplace/jumia/callback/runtime.ts',
    'apps/web/src/app/api/marketplace/jumia/callback/runtime-impl.ts',
    'apps/web/src/app/api/marketplace/jumia/callback/oauth-persistence.ts',
    ...clientPath,
  ],
  [
    'apps/web/src/app/api/marketplace/jumia/connect/route.ts',
    'apps/web/src/app/api/marketplace/jumia/connect/post.ts',
    'apps/web/src/app/api/marketplace/jumia/connect/self-authorization-connect-request.ts',
    'apps/web/src/app/api/marketplace/jumia/connect/validate-jumia-self-authorization-for-connect.ts',
    'apps/web/src/lib/jumia/jumia-authorization-refresh-lease.ts',
    loadGrant,
    credentialClient,
  ],
] as const;
