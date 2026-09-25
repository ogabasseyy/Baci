import { describe, expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';

const { postMcpJsonRpc, startMcpServerWithPostgrest } = mcpServerTestSupport;

describe('MCP image request quota', () => {
  it('does not spend the MCP tool quota when loading product images', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      for (let index = 0; index < 61; index++) {
        const response = await fetch(`${server.baseUrl}/images/private/missing-${index}.webp`);
        expect(response.status).toBe(404);
      }
      const tools = await postMcpJsonRpc(server.baseUrl, {
        id: 1,
        method: 'tools/list',
        params: {},
      });
      expect(tools.result).toMatchObject({ tools: expect.any(Array) });
    } finally {
      await server.close();
    }
  });
});
