import { AGENT_READINESS_CACHE_CONTROL } from '@/config/agent-readiness';
import { buildRequestBaseUrl } from '@/lib/storefront-host';

function buildAuthMarkdown(baseUrl: string): string {
  return `# auth.md

Ogabassey publishes agent authentication and discovery metadata for the
current storefront host at ${baseUrl}.

Ogabassey exposes public catalog and storefront discovery surfaces for agents.

## Step 1 - Discover

- Agent commerce manifest: ${baseUrl}/agent-commerce.json
- UCP profile: ${baseUrl}/.well-known/ucp
- ACP profile: ${baseUrl}/.well-known/acp.json
- OpenAPI description: ${baseUrl}/openapi.json
- MCP server card: ${baseUrl}/.well-known/mcp/server-card.json
- OAuth Protected Resource Metadata: ${baseUrl}/.well-known/oauth-protected-resource
- OAuth Authorization Server Metadata: ${baseUrl}/.well-known/oauth-authorization-server

## Step 2 - Authenticate

Browser and account APIs use the OAuth/OIDC authorization server advertised in
the protected-resource metadata. Agentic catalog, checkout, and order routes
use the bearer_hmac contract described in agent-commerce.json.

## agent_auth

The OAuth Authorization Server Metadata includes an \`agent_auth\` block for
agent registration discovery:

- register_uri: ${baseUrl}/.well-known/agent-auth
- claim_uri: ${baseUrl}/.well-known/agent-auth/claim
- revocation_uri: ${baseUrl}/.well-known/agent-auth/revoke
- identity_types_supported: identity_assertion
- assertion_types_supported: urn:ietf:params:oauth:token-type:id-jag
- credential_types_supported: api_key
- credential_format: bearer_hmac

Ogabassey currently issues agent checkout credentials only to approved
integrations after review. Unknown agents should not expect automatic OAuth
client registration or public credential issuance.

## Step 3 - Use Agentic Credentials

Approved agentic clients present \`Authorization: Bearer <credential>\` plus the
request integrity headers documented in agent-commerce.json. All mutating
actions also require explicit user intent and idempotency keys;
read-only catalog queries remain signed but do not require an idempotency key.

## Errors

Treat 401 responses as expired or invalid credentials, 403 responses as denied
scope or merchant policy, 409 responses as recoverable checkout or account-state
conflicts that require user resolution or retry, and 428 responses as missing
user confirmation.
Agents should not invent OAuth clients or request merchant/customer account
access through browser sessions.
`;
}

export function GET(request: Request): Response {
  return new Response(buildAuthMarkdown(buildRequestBaseUrl(request)), {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': AGENT_READINESS_CACHE_CONTROL,
      'Vercel-CDN-Cache-Control': 'no-store',
      'X-Robots-Tag': 'noarchive',
    },
  });
}
