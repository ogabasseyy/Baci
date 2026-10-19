import { NextResponse } from 'next/server';
import {
  AGENT_READINESS_CACHE_CONTROL,
  BACI_MCP_SERVER_URL,
} from '@/config/agent-readiness';

import { PUBLIC_MCP_TOOLS } from '@/config/mcp-server-card-tools';

export function GET(): NextResponse {
  return NextResponse.json(
    {
      $schema:
        'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
      version: '1.0',
      protocolVersion: '2025-06-18',
      serverInfo: {
        name: 'ogabassey-store',
        title: 'Ogabassey Store MCP Server',
        version: '1.0.0',
      },
      description:
        'Search products, inspect variants, add items to cart, confirm delivery-fee information, browse categories, and get store information for Ogabassey.',
      transport: {
        type: 'streamable-http',
        endpoint: BACI_MCP_SERVER_URL,
      },
      authentication: {
        required: false,
      },
      capabilities: {
        tools: true,
        resources: false,
        prompts: false,
      },
      tools: PUBLIC_MCP_TOOLS,
    },
    {
      headers: {
        'Cache-Control': AGENT_READINESS_CACHE_CONTROL,
      },
    }
  );
}
