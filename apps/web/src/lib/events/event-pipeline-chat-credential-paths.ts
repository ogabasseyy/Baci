const envPath = 'apps/web/src/env.ts';
const chatTenant = 'apps/web/src/lib/agentic/agentic-chat-tenant.ts';
const storefrontMerchant = 'apps/web/src/lib/storefront-merchant.ts';
const merchantIdentifierAlias =
  'apps/web/src/lib/get-merchant-by-identifier-or-alias.ts';
const cachedData = 'apps/web/src/lib/cached-data.ts';
const scopedSupabase = 'apps/web/src/lib/agentic/scoped-supabase.ts';
const scopedJwt = 'apps/web/src/lib/supabase/scoped-jwt.ts';
const jwtSigningMaterial = 'apps/web/src/lib/agentic/jwt-signing-material.ts';

// The configured chat tenant resolves through the cached storefront merchant
// reader, and Santa analytics mints short-lived scoped RLS clients. Both reach
// the credential-bearing environment module through these exact import paths.
const merchantTail = [
  storefrontMerchant,
  merchantIdentifierAlias,
  cachedData,
  envPath,
];
const scopedJwtTail = [scopedJwt, jwtSigningMaterial, envPath];

export const eventPipelineChatCredentialPaths = [
  ['apps/web/src/ai/chat-order-cancellation.ts', chatTenant, ...merchantTail],
  ['apps/web/src/ai/chat-tool-handlers.ts', chatTenant, ...merchantTail],
  [
    'apps/web/src/app/api/chat/chat-tool-runtime.ts',
    'apps/web/src/ai/chat-order-cancellation.ts',
    chatTenant,
    ...merchantTail,
  ],
  [
    'apps/web/src/app/api/chat/route.ts',
    'apps/web/src/app/api/chat/ollama-chat-tool-runtime.ts',
    'apps/web/src/ai/chat-order-cancellation.ts',
    chatTenant,
    ...merchantTail,
  ],
  [
    'apps/web/src/app/api/chat/run-chat-provider-chain.ts',
    'apps/web/src/app/api/chat/chat-tool-runtime.ts',
    'apps/web/src/ai/chat-order-cancellation.ts',
    chatTenant,
    ...merchantTail,
  ],
  [
    'apps/web/src/app/api/chat/santa/product/route.ts',
    chatTenant,
    ...merchantTail,
  ],
  [
    'apps/web/src/app/api/chat/santa/route.ts',
    'apps/web/src/app/api/chat/santa/santa-analytics.ts',
    scopedSupabase,
    ...scopedJwtTail,
  ],
  ['apps/web/src/app/api/chat/santa/route.ts', chatTenant, ...merchantTail],
  [
    'apps/web/src/app/api/chat/santa/santa-analytics.ts',
    scopedSupabase,
    ...scopedJwtTail,
  ],
  [chatTenant, ...merchantTail],
] as const;
