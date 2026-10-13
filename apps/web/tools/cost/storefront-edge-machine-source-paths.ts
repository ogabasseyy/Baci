/** Root handlers/configuration that authorize every static machine-family row. */
export const STOREFRONT_EDGE_MACHINE_SOURCE_PATHS = {
  '/.well-known/acp.json': 'apps/web/src/app/.well-known/acp.json/route.ts',
  '/.well-known/agent-auth': 'apps/web/src/app/.well-known/agent-auth/route.ts',
  '/.well-known/agent-auth/claim':
    'apps/web/src/app/.well-known/agent-auth/[action]/route.ts',
  '/.well-known/agent-auth/revoke':
    'apps/web/src/app/.well-known/agent-auth/[action]/route.ts',
  '/.well-known/agent-native-commerce':
    'apps/web/src/app/.well-known/agent-native-commerce/route.ts',
  '/.well-known/agent-skills/baci-storefront/SKILL.md':
    'apps/web/src/app/.well-known/agent-skills/baci-storefront/SKILL.md/route.ts',
  '/.well-known/agent-skills/index.json':
    'apps/web/src/app/.well-known/agent-skills/index.json/route.ts',
  '/.well-known/api-catalog':
    'apps/web/src/app/.well-known/api-catalog/route.ts',
  '/.well-known/apple-app-site-association':
    'apps/web/src/app/.well-known/apple-app-site-association/route.ts',
  '/.well-known/assetlinks.json':
    'apps/web/src/app/.well-known/assetlinks.json/route.ts',
  '/.well-known/http-message-signatures-directory':
    'apps/web/src/app/.well-known/http-message-signatures-directory/route.ts',
  '/.well-known/llms-full.txt':
    'apps/web/src/app/.well-known/llms-full.txt/route.ts',
  '/.well-known/llms.txt': 'apps/web/src/app/.well-known/llms.txt/route.ts',
  '/.well-known/mcp/server-card.json':
    'apps/web/src/app/.well-known/mcp/server-card.json/route.ts',
  '/.well-known/oauth-authorization-server':
    'apps/web/src/app/.well-known/oauth-authorization-server/route.ts',
  '/.well-known/oauth-authorization-server/agent-auth/v1':
    'apps/web/src/app/.well-known/oauth-authorization-server/agent-auth/v1/route.ts',
  '/.well-known/oauth-protected-resource':
    'apps/web/src/app/.well-known/oauth-protected-resource/route.ts',
  '/.well-known/openid-configuration':
    'apps/web/src/app/.well-known/openid-configuration/route.ts',
  '/.well-known/ucp': 'apps/web/src/app/.well-known/ucp/route.ts',
  '/.well-known/{*unlisted?}':
    'apps/web/src/app/.well-known/[...rest]/route.ts',
  '/0751d5c882ab3d7c013ecbfe9e624d71.txt':
    'apps/web/src/app/0751d5c882ab3d7c013ecbfe9e624d71.txt/route.ts',
  '/_next/image': 'apps/web/next.config.ts',
  '/_next/static/{*asset}': 'apps/web/next.config.ts',
  '/_next/{*unlisted?}': 'apps/web/next.config.ts',
  '/ads.txt': 'apps/web/src/app/ads.txt/route.ts',
  '/app-ads.txt': 'apps/web/src/app/app-ads.txt/route.ts',
  '/agent-commerce.json': 'apps/web/src/app/agent-commerce.json/route.ts',
  '/agent-trust.json': 'apps/web/src/app/agent-trust.json/route.ts',
  '/auth.md': 'apps/web/src/app/auth.md/route.ts',
  '/feeds/agent-products.jsonl':
    'apps/web/src/app/feeds/agent-products.jsonl/route.ts',
  '/feeds/agent-repairs.jsonl':
    'apps/web/src/app/feeds/agent-repairs.jsonl/route.ts',
  '/feeds/facebook-repairs.xml':
    'apps/web/src/app/feeds/facebook-repairs.xml/route.ts',
  '/feeds/facebook.xml': 'apps/web/src/app/feeds/facebook.xml/route.ts',
  '/feeds/google-merchant.xml':
    'apps/web/src/app/feeds/google-merchant.xml/route.ts',
  '/feeds/openai.jsonl': 'apps/web/src/app/feeds/openai.jsonl/route.ts',
  '/llms-full.txt': 'apps/web/src/app/llms-full.txt/route.ts',
  '/llms.txt': 'apps/web/src/app/llms.txt/route.ts',
  '/manifest.webmanifest': 'apps/web/src/app/manifest.ts',
  '/openapi.json': 'apps/web/src/app/openapi.json/route.ts',
  '/robots.txt': 'apps/web/src/app/robots.ts',
} as const satisfies Readonly<Record<string, string>>;
