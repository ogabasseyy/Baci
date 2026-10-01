// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'MCP_PUBLIC_SERVER_URL',
  'MCP_PUBLIC_HEALTH_URL',
  'NEXT_PUBLIC_MCP_SERVER_URL',
  'NEXT_PUBLIC_MCP_HEALTH_URL',
  'OGABASSEY_AGENT_ORIGIN',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

const PUBLIC_MCP_TOOL_NAMES = [
  'search_products',
  'add_to_cart',
  'get_product',
  'get_product_variants',
  'get_store_info',
  'browse_categories',
  'get_brands',
  'get_shipping_quote',
];

function importAgentReadiness(
  overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>
) {
  vi.resetModules();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, {
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    ...overrides,
  });

  return import('./agent-readiness');
}

afterEach(() => {
  vi.resetModules();
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('agent readiness config', () => {
  it('uses production Ogabassey discovery defaults', async () => {
    const config = await importAgentReadiness({});

    expect(config.BACI_MCP_SERVER_URL).toBe('https://mcp.ogabassey.com/mcp');
    expect(config.BACI_MCP_HEALTH_URL).toBe('https://mcp.ogabassey.com/health');
    expect(config.OGABASSEY_AGENT_DISCOVERY_LINK_HEADER).toContain(
      '</.well-known/api-catalog>; rel="api-catalog"'
    );
    expect(config.OGABASSEY_AGENT_DISCOVERY_LINK_HEADER).toContain(
      '</.well-known/mcp/server-card.json>; rel="service-desc"'
    );
    expect(config.BACI_AGENT_SKILL_MARKDOWN).toContain(
      'https://ogabassey.com/.well-known/ucp'
    );
    for (const toolName of PUBLIC_MCP_TOOL_NAMES) {
      expect(config.BACI_AGENT_SKILL_MARKDOWN).toContain(`- ${toolName}:`);
    }
    expect(config.BACI_AGENT_SKILL_MARKDOWN).not.toContain(
      'create_agentic_checkout_session'
    );
    expect(config.BACI_AGENT_SKILL_MARKDOWN).not.toContain('check_order');
  });

  it('supports environment-specific MCP and storefront discovery URLs', async () => {
    const config = await importAgentReadiness({
      MCP_PUBLIC_SERVER_URL: 'https://mcp.staging.example/mcp',
      MCP_PUBLIC_HEALTH_URL: 'https://mcp.staging.example/health',
      OGABASSEY_AGENT_ORIGIN: 'https://storefront.staging.example',
    });

    expect(config.BACI_MCP_SERVER_URL).toBe('https://mcp.staging.example/mcp');
    expect(config.BACI_MCP_HEALTH_URL).toBe(
      'https://mcp.staging.example/health'
    );
    expect(config.BACI_AGENT_SKILL_MARKDOWN).toContain(
      'https://storefront.staging.example/llms.txt'
    );
    expect(config.BACI_AGENT_SKILL_MARKDOWN).toContain(
      'https://mcp.staging.example/mcp'
    );
  });

  it('falls back to NEXT_PUBLIC MCP URLs when MCP_PUBLIC values are absent', async () => {
    const config = await importAgentReadiness({
      NEXT_PUBLIC_MCP_SERVER_URL: 'https://mcp.public.example/mcp',
      NEXT_PUBLIC_MCP_HEALTH_URL: 'https://mcp.public.example/health',
      OGABASSEY_AGENT_ORIGIN: 'https://storefront.public.example',
    });

    expect(config.BACI_MCP_SERVER_URL).toBe('https://mcp.public.example/mcp');
    expect(config.BACI_MCP_HEALTH_URL).toBe(
      'https://mcp.public.example/health'
    );
    expect(config.BACI_AGENT_SKILL_MARKDOWN).toContain(
      'https://storefront.public.example/llms.txt'
    );
    expect(config.BACI_AGENT_SKILL_MARKDOWN).toContain(
      'https://mcp.public.example/mcp'
    );
  });

  it('treats empty discovery environment values as unset', async () => {
    const config = await importAgentReadiness({
      MCP_PUBLIC_SERVER_URL: '   ',
      MCP_PUBLIC_HEALTH_URL: '',
      NEXT_PUBLIC_MCP_SERVER_URL: '\t',
      NEXT_PUBLIC_MCP_HEALTH_URL: '  ',
      OGABASSEY_AGENT_ORIGIN: ' ',
    });

    expect(config.BACI_MCP_SERVER_URL).toBe('https://mcp.ogabassey.com/mcp');
    expect(config.BACI_MCP_HEALTH_URL).toBe('https://mcp.ogabassey.com/health');
    expect(config.BACI_AGENT_SKILL_MARKDOWN).toContain(
      'https://ogabassey.com/llms.txt'
    );
    expect(config.BACI_AGENT_SKILL_MARKDOWN).toContain(
      'https://mcp.ogabassey.com/mcp'
    );
    expect(config.BACI_AGENT_SKILL_MARKDOWN).not.toContain(
      '- Storefront origin: \n'
    );
    expect(config.BACI_AGENT_SKILL_MARKDOWN).not.toContain('- MCP server: \n');
  });
});
