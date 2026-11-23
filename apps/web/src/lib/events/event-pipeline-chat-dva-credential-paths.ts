// Exact scoped JWT path only. No admin/service factory permission is granted.
export const eventPipelineChatDvaCredentialPaths = [
  // The payment route mints a 60 second claim for the chat account fence RPC.
  [
    'apps/web/src/lib/payments/begin-paystack-dva-attempt.ts',
    'apps/web/src/lib/supabase/scoped-jwt.ts',
    'apps/web/src/lib/agentic/jwt-signing-material.ts',
    'apps/web/src/env.ts',
  ],
];
