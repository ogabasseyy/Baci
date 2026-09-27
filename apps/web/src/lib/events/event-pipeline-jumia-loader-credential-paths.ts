// Credential paths for the jumia_credential_loader capability boundary.
// User-facing grant loads mint a short-lived capability JWT (scoped-jwt +
// JWT signing material) instead of elevating to service_role. Every audited
// route/helper chain reaching the signing material is enumerated explicitly.
const envPath = 'apps/web/src/env.ts';
const client = 'apps/web/src/lib/jumia/client.ts';
const clientConfig = 'apps/web/src/lib/jumia/jumia-client-config.ts';
const tokenPersistence =
  'apps/web/src/lib/jumia/jumia-client-token-persistence.ts';
const tokenRotation = 'apps/web/src/lib/jumia/jumia-client-token-rotation.ts';
const refreshLease =
  'apps/web/src/lib/jumia/jumia-authorization-refresh-lease.ts';
const grantLoader = 'apps/web/src/lib/jumia/load-jumia-authorization-grant.ts';
const loaderClient = 'apps/web/src/lib/jumia/jumia-credential-loader-client.ts';
const scopedJwt = 'apps/web/src/lib/supabase/scoped-jwt.ts';
const jwtSigningMaterial = 'apps/web/src/lib/agentic/jwt-signing-material.ts';
const callbackRoot = 'apps/web/src/app/api/marketplace/jumia/callback';
const callbackRoute = `${callbackRoot}/route.ts`;
const callbackFlow = `${callbackRoot}/callback-flow.ts`;
const callbackHandler = `${callbackRoot}/handler.ts`;
const callbackRuntime = `${callbackRoot}/runtime.ts`;
const callbackRuntimeImpl = `${callbackRoot}/runtime-impl.ts`;
const oauthPersistence = `${callbackRoot}/oauth-persistence.ts`;
const connectRoot = 'apps/web/src/app/api/marketplace/jumia/connect';
const connectRoute = `${connectRoot}/route.ts`;
const connectPost = `${connectRoot}/post.ts`;
const selfAuthorizationConnectRequest = `${connectRoot}/self-authorization-connect-request.ts`;
const validateSelfAuthorizationForConnect = `${connectRoot}/validate-jumia-self-authorization-for-connect.ts`;
const claimResumedAuthorization = `${connectRoot}/claim-jumia-resumed-authorization.ts`;
const consignmentStockRoute =
  'apps/web/src/app/api/marketplace/jumia/consignment/get-jumia-consignment-stock.ts';
const oauthShopDiscovery =
  'apps/web/src/app/api/marketplace/jumia/connect/exchange/discover-jumia-oauth-shops.ts';
const exchangeRoute =
  'apps/web/src/app/api/marketplace/jumia/connect/exchange/route.ts';
const orderSync = 'apps/web/src/lib/jumia/order-sync.ts';
const stockSyncIntegration =
  'apps/web/src/lib/jumia/sync-jumia-stock-integration.ts';
const orderSyncScript = 'apps/web/src/scripts/sync-jumia-orders.ts';

const loaderTail = [
  grantLoader,
  loaderClient,
  scopedJwt,
  jwtSigningMaterial,
  envPath,
];
const loaderViaClient = [client, clientConfig, ...loaderTail];
const loaderViaRefreshLease = [refreshLease, ...loaderTail];

function withPrefix(
  prefix: readonly string[],
  suffixes: readonly (readonly string[])[]
): readonly (readonly string[])[] {
  return suffixes.map((suffix) => [...prefix, ...suffix]);
}

const loaderClientRoutes = [
  'apps/web/src/app/api/marketplace/jumia/actions/route.ts',
  'apps/web/src/app/api/marketplace/jumia/brands/route.ts',
  'apps/web/src/app/api/marketplace/jumia/categories/route.ts',
  'apps/web/src/app/api/marketplace/jumia/consignment/route.ts',
  'apps/web/src/app/api/marketplace/jumia/orders/[id]/items/route.ts',
  'apps/web/src/app/api/marketplace/jumia/orders/route.ts',
  'apps/web/src/app/api/marketplace/jumia/products/export/route.ts',
  'apps/web/src/app/api/marketplace/jumia/products/feed-status/route.ts',
  'apps/web/src/app/api/marketplace/jumia/products/import/route.ts',
  'apps/web/src/app/api/marketplace/jumia/products/stock/route.ts',
  'apps/web/src/app/api/marketplace/jumia/products/update/route.ts',
];

export const eventPipelineJumiaLoaderCredentialPaths: readonly (readonly string[])[] =
  [
    [loaderClient, scopedJwt, jwtSigningMaterial, envPath],
    [...loaderTail],
    [clientConfig, ...loaderTail],
    [...loaderViaClient],
    [...loaderViaRefreshLease],
    [tokenRotation, ...loaderTail],
    [tokenPersistence, ...loaderViaRefreshLease],
    [claimResumedAuthorization, ...loaderTail],
    ...loaderClientRoutes.flatMap((route) =>
      withPrefix([route], [loaderViaClient])
    ),
    ...withPrefix([consignmentStockRoute], [loaderViaClient]),
    ...withPrefix([orderSync], [loaderViaClient]),
    ...withPrefix([orderSyncScript, orderSync], [loaderViaClient]),
    ...withPrefix([stockSyncIntegration], [loaderViaClient]),
    ...withPrefix([oauthShopDiscovery], [loaderViaClient]),
    ...withPrefix([exchangeRoute, oauthShopDiscovery], [loaderViaClient]),
    ...withPrefix(
      [
        callbackRoute,
        callbackHandler,
        callbackFlow,
        callbackRuntime,
        callbackRuntimeImpl,
        oauthPersistence,
      ],
      [loaderViaClient]
    ),
    ...withPrefix(
      [
        callbackHandler,
        callbackFlow,
        callbackRuntime,
        callbackRuntimeImpl,
        oauthPersistence,
      ],
      [loaderViaClient]
    ),
    ...withPrefix(
      [callbackFlow, callbackRuntime, callbackRuntimeImpl, oauthPersistence],
      [loaderViaClient]
    ),
    ...withPrefix(
      [callbackRuntime, callbackRuntimeImpl, oauthPersistence],
      [loaderViaClient]
    ),
    ...withPrefix([callbackRuntimeImpl, oauthPersistence], [loaderViaClient]),
    ...withPrefix([oauthPersistence], [loaderViaClient]),
    ...withPrefix(
      [
        connectRoute,
        connectPost,
        selfAuthorizationConnectRequest,
        validateSelfAuthorizationForConnect,
      ],
      [loaderViaRefreshLease]
    ),
    ...withPrefix(
      [
        connectPost,
        selfAuthorizationConnectRequest,
        validateSelfAuthorizationForConnect,
      ],
      [loaderViaRefreshLease]
    ),
    ...withPrefix(
      [selfAuthorizationConnectRequest, validateSelfAuthorizationForConnect],
      [loaderViaRefreshLease]
    ),
    ...withPrefix(
      [validateSelfAuthorizationForConnect],
      [loaderViaRefreshLease]
    ),
  ];
