import { env } from '@/env';

export { OGABASSEY_AGENT_DISCOVERY_LINK_HEADER } from './agent-discovery-link-header';

export const AGENT_READINESS_CACHE_CONTROL =
  'public, max-age=3600, s-maxage=3600';

export const BACI_AGENT_SKILL_DESCRIPTION =
  'Use Ogabassey storefront agent-commerce, catalog, and MCP discovery safely.';

export const BACI_AGENT_SKILL_PATH =
  '/.well-known/agent-skills/baci-storefront/SKILL.md';

const OGABASSEY_ORIGIN = env.OGABASSEY_AGENT_ORIGIN ?? 'https://ogabassey.com';
const DEFAULT_MCP_ORIGIN = 'https://mcp.ogabassey.com';

export const BACI_MCP_SERVER_URL =
  env.MCP_PUBLIC_SERVER_URL ??
  env.NEXT_PUBLIC_MCP_SERVER_URL ??
  `${DEFAULT_MCP_ORIGIN}/mcp`;
export const BACI_MCP_HEALTH_URL =
  env.MCP_PUBLIC_HEALTH_URL ??
  env.NEXT_PUBLIC_MCP_HEALTH_URL ??
  `${DEFAULT_MCP_ORIGIN}/health`;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '') || OGABASSEY_ORIGIN;
}

export function buildAgentSkillMarkdown(baseUrl: string): string {
  const storefrontOrigin = normalizeBaseUrl(baseUrl);
  const llmGuideUrl = `${storefrontOrigin}/llms.txt`;
  const llmFullGuideUrl = `${storefrontOrigin}/llms-full.txt`;
  const ucpProfileUrl = `${storefrontOrigin}/.well-known/ucp`;
  const acpProfileUrl = `${storefrontOrigin}/.well-known/acp.json`;
  const agentCommerceUrl = `${storefrontOrigin}/agent-commerce.json`;
  const openApiUrl = `${storefrontOrigin}/openapi.json`;
  const agentRepairsFeedUrl = `${storefrontOrigin}/feeds/agent-repairs.jsonl`;

  return `---
name: baci-storefront
description: ${BACI_AGENT_SKILL_DESCRIPTION}
---

# Baci Storefront Agent Skill

Use this skill when helping a user browse, compare, or buy from Ogabassey, a Baci-powered storefront.

## Discovery

- Storefront origin: ${storefrontOrigin}
- LLM guide: ${llmGuideUrl}
- Full LLM guide: ${llmFullGuideUrl}
- UCP profile: ${ucpProfileUrl}
- ACP profile: ${acpProfileUrl}
- Agent commerce manifest: ${agentCommerceUrl}
- OpenAPI description: ${openApiUrl}
- Repairs services feed: ${agentRepairsFeedUrl}
- MCP server: ${BACI_MCP_SERVER_URL}

## Safety

- Read catalog, product, policy, and availability information before taking actions.
- Use add_to_cart only when the user asks to add a specific product to cart.
- Do not submit checkout, payment, account, wallet, or order-management actions.
- Use the current storefront host as canonical when resolving product and cart URLs.
- For device repairs, read the repairs services feed and link users to the
  storefront /repairs pages; do not attempt to book a repair on the user's behalf.

## Useful MCP Tools

- search_products: search product names, categories, brands, conditions, and price ranges.
- add_to_cart: add a specific product ID to the user's cart after the user asks.
- get_product: fetch detailed product information by product_id or exact product_name.
- get_product_variants: fetch available colors, storage options, SIM options, and condition offers.
- get_store_info: answer contact, shipping, returns, payment, general, and policy questions.
- browse_categories: list available catalog categories.
- get_brands: list available brands, optionally filtered by category.
- get_shipping_quote: estimate delivery options for a Nigerian destination.
`;
}

export const BACI_AGENT_SKILL_MARKDOWN =
  buildAgentSkillMarkdown(OGABASSEY_ORIGIN);
