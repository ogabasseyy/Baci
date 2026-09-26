import { describe, expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';

const { getResultTools, postMcpJsonRpc, startMcpServerWithPostgrest } =
  mcpServerTestSupport;

describe('MCP order payment tool modes', () => {
  it('keeps unauthenticated order and payment tools unavailable even when the legacy flag is set', async () => {
    const server = await startMcpServerWithPostgrest({
      AGENTIC_PAYSTACK_DVA_MODE: 'enabled',
      MCP_ENABLE_ORDER_PAYMENT_TOOLS: '1',
    });
    try {
      const payload = await postMcpJsonRpc(server.baseUrl, {
        id: 3,
        method: 'tools/list',
        params: {},
      });
      const names = getResultTools(payload).map((tool) => tool.name);
      expect(names).not.toContain('check_order');
      expect(names).not.toContain('generate_payment_account');
      expect(names).not.toContain('check_payment_status');
    } finally {
      await server.close();
    }
  });
});
