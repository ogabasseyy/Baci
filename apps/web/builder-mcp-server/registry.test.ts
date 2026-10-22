// @vitest-environment node
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import { builderToolPolicy } from '../src/lib/builder-connector/tool-policy';
import { createBuilderMcpServer } from './server';

const names = [
  'list_storefronts',
  'get_storefront_status',
  'create_storefront_draft',
  'update_storefront_draft',
  'get_storefront_operation',
  'apply_storefront_operation',
];
async function connected(
  token: string | undefined,
  executeBuilderTool = vi.fn()
) {
  const server = createBuilderMcpServer({
    bearerToken: token,
    executeBuilderTool,
  });
  const client = new Client({ name: 'builder-fixture', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  return {
    client,
    executeBuilderTool,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
describe('separate builder tool registry', () => {
  it('advertises only six implemented strict tools with per-tool OAuth and no UI', async () => {
    const f = await connected(undefined);
    try {
      const { tools } = await f.client.listTools();
      expect(tools.map((t) => t.name)).toEqual(names);
      for (const tool of tools) {
        const policy =
          builderToolPolicy[tool.name as keyof typeof builderToolPolicy];
        expect(tool.inputSchema.additionalProperties).toBe(false);
        expect(tool.outputSchema).toBeDefined();
        expect(tool).toMatchObject({
          annotations: policy.annotations,
          _meta: { securitySchemes: policy.securitySchemes },
        });
        expect(tool._meta).not.toHaveProperty('ui');
        expect(tool._meta).not.toHaveProperty('openai/outputTemplate');
      }
      expect(f.executeBuilderTool).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
  it('requires linking before calling a backend and returns a full OAuth challenge', async () => {
    const f = await connected(undefined);
    try {
      const r = await f.client.callTool({
        name: 'list_storefronts',
        arguments: {},
      });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r._meta)).toContain('mcp/www_authenticate');
      expect(JSON.stringify(r._meta)).toContain('error_description');
      expect(f.executeBuilderTool).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
  it('returns validated structured output and useful text, rejecting private extra fields', async () => {
    const execute = vi.fn().mockResolvedValue({ stores: [], nextCursor: null });
    const f = await connected('outer.fixture', execute);
    try {
      const r = await f.client.callTool({
        name: 'list_storefronts',
        arguments: {},
      });
      expect(r.structuredContent).toEqual({ stores: [], nextCursor: null });
      expect(r.content).toMatchObject([
        { type: 'text', text: expect.any(String) },
      ]);
      expect(execute).toHaveBeenCalledWith(
        'outer.fixture',
        'list_storefronts',
        expect.any(Object),
        undefined
      );
      execute.mockResolvedValue({
        stores: [],
        nextCursor: null,
        upstreamToken: 'never-display',
      });
      const bad = await f.client.callTool({
        name: 'list_storefronts',
        arguments: {},
      });
      expect(bad.isError).toBe(true);
      expect(JSON.stringify(bad)).not.toContain('never-display');
    } finally {
      await f.close();
    }
  });
  it('rejects extra tool arguments before backend access', async () => {
    const f = await connected('outer.fixture');
    try {
      const r = await f.client.callTool({
        name: 'list_storefronts',
        arguments: { token: 'secret' },
      });
      expect(r.isError).toBe(true);
      expect(f.executeBuilderTool).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
});
