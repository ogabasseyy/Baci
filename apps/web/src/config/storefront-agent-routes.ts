/**
 * Public storefront machine-readable agent contract routes.
 */
export const STOREFRONT_AGENT_ROUTES = {
  acpProfile: '/.well-known/acp.json',
  agentNativeCommerce: '/.well-known/agent-native-commerce',
  agentSkillIndex: '/.well-known/agent-skills/index.json',
  agentSkillMarkdown: '/.well-known/agent-skills/baci-storefront/SKILL.md',
  appAds: '/app-ads.txt',
  agenticApiBase: '/api/agentic',
  apiCatalog: '/.well-known/api-catalog',
  authDoc: '/auth.md',
  manifest: '/agent-commerce.json',
  mcpServerCard: '/.well-known/mcp/server-card.json',
  openApi: '/openapi.json',
  trust: '/agent-trust.json',
  ucpProfile: '/.well-known/ucp',
} as const;
