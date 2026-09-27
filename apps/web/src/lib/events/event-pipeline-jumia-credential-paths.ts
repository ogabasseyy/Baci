import { eventPipelineJumiaLoaderCredentialPaths } from './event-pipeline-jumia-loader-credential-paths';

const envPath = 'apps/web/src/env.ts';
const client = 'apps/web/src/lib/jumia/client.ts';
const clientConfig = 'apps/web/src/lib/jumia/jumia-client-config.ts';
const tokenPersistence =
  'apps/web/src/lib/jumia/jumia-client-token-persistence.ts';
const tokenRotation = 'apps/web/src/lib/jumia/jumia-client-token-rotation.ts';
const refreshLease =
  'apps/web/src/lib/jumia/jumia-authorization-refresh-lease.ts';
const jumiaHelpers = 'apps/web/src/lib/jumia/helpers.ts';
const oauthPersistence =
  'apps/web/src/app/api/marketplace/jumia/callback/oauth-persistence.ts';
const mobileTicket =
  'apps/web/src/app/api/marketplace/jumia/connect/mobile-ticket.ts';
const callbackRoot = 'apps/web/src/app/api/marketplace/jumia/callback';
const callbackFlow = `${callbackRoot}/callback-flow.ts`;
const callbackHandler = `${callbackRoot}/handler.ts`;
const callbackRuntime = `${callbackRoot}/runtime.ts`;
const callbackRuntimeImpl = `${callbackRoot}/runtime-impl.ts`;
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
const expoPush = 'apps/web/src/lib/expo-push.ts';
const supabaseAdmin = 'apps/web/src/lib/supabase/admin.ts';
const ordersRoute = 'apps/web/src/app/api/marketplace/jumia/orders/route.ts';
const manualOrderSync =
  'apps/web/src/app/api/marketplace/jumia/orders/sync-jumia-manual-orders.ts';
const stockSyncIntegration =
  'apps/web/src/lib/jumia/sync-jumia-stock-integration.ts';

const clientCredentialSuffixes = [
  [client, envPath],
  [client, clientConfig, envPath],
  [client, tokenPersistence, envPath],
  [client, tokenPersistence, jumiaHelpers, envPath],
  [client, tokenPersistence, refreshLease, envPath],
  [client, tokenPersistence, tokenRotation, envPath],
  [client, tokenPersistence, tokenRotation, jumiaHelpers, envPath],
  [client, tokenPersistence, tokenRotation, refreshLease, envPath],
] as const;

const jumiaApiRoutesUsingClient = [
  'apps/web/src/app/api/marketplace/jumia/actions/route.ts',
  'apps/web/src/app/api/marketplace/jumia/brands/route.ts',
  'apps/web/src/app/api/marketplace/jumia/categories/route.ts',
  'apps/web/src/app/api/marketplace/jumia/connect/exchange/route.ts',
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

function withPrefix(
  prefix: readonly string[],
  suffixes: readonly (readonly string[])[]
): readonly (readonly string[])[] {
  return suffixes.map((suffix) => [...prefix, ...suffix]);
}

const callbackRuntimeImplPaths = withPrefix(
  [callbackRuntimeImpl],
  [
    [envPath],
    [jumiaHelpers, envPath],
    ...clientCredentialSuffixes,
    ...withPrefix([oauthPersistence], clientCredentialSuffixes),
  ]
);

const callbackRuntimePaths = withPrefix(
  [callbackRuntime, callbackRuntimeImpl],
  [
    [envPath],
    [jumiaHelpers, envPath],
    ...clientCredentialSuffixes,
    ...withPrefix([oauthPersistence], clientCredentialSuffixes),
  ]
);

const callbackFlowPaths = withPrefix(
  [callbackFlow, callbackRuntime, callbackRuntimeImpl],
  [
    [envPath],
    [jumiaHelpers, envPath],
    ...clientCredentialSuffixes,
    ...withPrefix([oauthPersistence], clientCredentialSuffixes),
  ]
);

const callbackHandlerPaths = withPrefix(
  [callbackHandler, callbackFlow, callbackRuntime, callbackRuntimeImpl],
  [
    [envPath],
    [jumiaHelpers, envPath],
    ...clientCredentialSuffixes,
    ...withPrefix([oauthPersistence], clientCredentialSuffixes),
  ]
);

const callbackRoutePaths = withPrefix(
  [
    `${callbackRoot}/route.ts`,
    callbackHandler,
    callbackFlow,
    callbackRuntime,
    callbackRuntimeImpl,
  ],
  [
    [envPath],
    [jumiaHelpers, envPath],
    ...clientCredentialSuffixes,
    ...withPrefix([oauthPersistence], clientCredentialSuffixes),
  ]
);

export { clientCredentialSuffixes, jumiaApiRoutesUsingClient };

export const eventPipelineJumiaCredentialPaths = [
  ...callbackRuntimeImplPaths,
  ...callbackRuntimePaths,
  ...callbackFlowPaths,
  ...callbackHandlerPaths,
  ...callbackRoutePaths,
  [`${callbackRoot}/oauth-diagnostic.ts`, jumiaHelpers, envPath],
  [`${callbackRoot}/oauth-exchange.ts`, jumiaHelpers, envPath],
  [
    'apps/web/src/app/api/marketplace/jumia/connect/oauth-diagnostic.ts',
    jumiaHelpers,
    envPath,
  ],
  ...withPrefix(
    [oauthShopDiscovery],
    [...clientCredentialSuffixes, [client, jumiaHelpers, envPath]]
  ),
  ...withPrefix(
    [exchangeRoute, oauthShopDiscovery],
    [...clientCredentialSuffixes, [client, jumiaHelpers, envPath]]
  ),
  ...jumiaApiRoutesUsingClient.flatMap((route) =>
    withPrefix(
      [route],
      [...clientCredentialSuffixes, [client, jumiaHelpers, envPath]]
    )
  ),
  [
    'apps/web/src/app/api/marketplace/jumia/products/export/route.ts',
    'apps/web/src/app/api/marketplace/jumia/products/export/submit-jumia-export-feed.ts',
    jumiaHelpers,
    envPath,
  ],
  [
    'apps/web/src/app/api/marketplace/jumia/products/export/submit-jumia-export-feed.ts',
    jumiaHelpers,
    envPath,
  ],
  [
    'apps/web/src/app/api/marketplace/jumia/products/route.ts',
    jumiaHelpers,
    envPath,
  ],
  [
    'apps/web/src/app/api/marketplace/jumia/products/feed-status/route.ts',
    jumiaHelpers,
    envPath,
  ],
  [client, envPath],
  [client, clientConfig, envPath],
  [client, tokenPersistence, envPath],
  [client, tokenPersistence, jumiaHelpers, envPath],
  [client, tokenPersistence, refreshLease, envPath],
  [client, tokenPersistence, tokenRotation, envPath],
  [client, tokenPersistence, tokenRotation, jumiaHelpers, envPath],
  [client, tokenPersistence, tokenRotation, refreshLease, envPath],
  [clientConfig, envPath],
  [tokenPersistence, envPath],
  [tokenPersistence, jumiaHelpers, envPath],
  [tokenPersistence, refreshLease, envPath],
  [tokenPersistence, tokenRotation, envPath],
  [tokenPersistence, tokenRotation, jumiaHelpers, envPath],
  [tokenPersistence, tokenRotation, refreshLease, envPath],
  [tokenRotation, envPath],
  [tokenRotation, jumiaHelpers, envPath],
  [tokenRotation, refreshLease, envPath],
  [refreshLease, envPath],
  [claimResumedAuthorization, refreshLease, envPath],
  [validateSelfAuthorizationForConnect, refreshLease, envPath],
  [
    selfAuthorizationConnectRequest,
    validateSelfAuthorizationForConnect,
    refreshLease,
    envPath,
  ],
  [
    validateSelfAuthorizationForConnect,
    claimResumedAuthorization,
    refreshLease,
    envPath,
  ],
  [
    selfAuthorizationConnectRequest,
    validateSelfAuthorizationForConnect,
    claimResumedAuthorization,
    refreshLease,
    envPath,
  ],
  [
    connectPost,
    selfAuthorizationConnectRequest,
    validateSelfAuthorizationForConnect,
    refreshLease,
    envPath,
  ],
  [
    connectPost,
    selfAuthorizationConnectRequest,
    validateSelfAuthorizationForConnect,
    claimResumedAuthorization,
    refreshLease,
    envPath,
  ],
  [
    connectRoute,
    connectPost,
    selfAuthorizationConnectRequest,
    validateSelfAuthorizationForConnect,
    refreshLease,
    envPath,
  ],
  [
    connectRoute,
    connectPost,
    selfAuthorizationConnectRequest,
    validateSelfAuthorizationForConnect,
    claimResumedAuthorization,
    refreshLease,
    envPath,
  ],
  ...withPrefix([consignmentStockRoute], clientCredentialSuffixes),
  ...withPrefix(
    ['apps/web/src/lib/jumia/order-sync.ts'],
    clientCredentialSuffixes
  ),
  // The five-minute VPS worker reaches the same order-sync closure; its
  // ciphertext reads travel on the restricted credential client.
  ...withPrefix(
    [
      'apps/web/src/scripts/sync-jumia-orders.ts',
      'apps/web/src/lib/jumia/order-sync.ts',
    ],
    clientCredentialSuffixes
  ),
  ['apps/web/src/lib/jumia/self-authorization.ts', jumiaHelpers, envPath],
  [
    'apps/web/src/app/api/cron/purge-jumia-self-authorization-discoveries/route.ts',
    envPath,
  ],
  [
    'apps/web/src/app/api/cron/purge-jumia-self-authorization-discoveries/route.ts',
    supabaseAdmin,
    envPath,
  ],
  [mobileTicket, envPath],
  [
    'apps/web/src/app/api/marketplace/jumia/connect/route.ts',
    mobileTicket,
    envPath,
  ],
  ...withPrefix([oauthPersistence], clientCredentialSuffixes),
  ...withPrefix([stockSyncIntegration], clientCredentialSuffixes),
  [manualOrderSync, expoPush, envPath],
  [manualOrderSync, expoPush, supabaseAdmin, envPath],
  [ordersRoute, manualOrderSync, expoPush, envPath],
  [ordersRoute, manualOrderSync, expoPush, supabaseAdmin, envPath],
  ...eventPipelineJumiaLoaderCredentialPaths,
] as const;
