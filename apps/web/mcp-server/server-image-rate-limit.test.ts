import { describe, expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';

const { postMcpJsonRpc, startMcpServerWithPostgrest } = mcpServerTestSupport;

describe('MCP image request quota', () => {
  it('uses only an explicitly trusted real-IP header when configured', async () => {
    const server = await startMcpServerWithPostgrest({ MCP_TRUST_PROXY_REAL_IP: 'true' });
    try {
      const request = (realIp: string, forwardedIp: string) => fetch(`${server.baseUrl}/missing`, {
        headers: { 'x-real-ip': realIp, 'x-forwarded-for': forwardedIp },
      });
      const first = await request('203.0.113.10', '198.51.100.1');
      const sameClient = await request('203.0.113.10', '198.51.100.2');
      const otherClient = await request('203.0.113.11', '198.51.100.2');
      expect(Number(first.headers.get('x-ratelimit-remaining'))).toBe(59);
      expect(Number(sameClient.headers.get('x-ratelimit-remaining'))).toBe(58);
      expect(Number(otherClient.headers.get('x-ratelimit-remaining'))).toBe(59);
    } finally {
      await server.close();
    }
  });

  it('cannot be bypassed by rotating a caller-supplied forwarded address', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      for (let index = 0; index < 240; index++) {
        const response = await fetch(`${server.baseUrl}/images/private/missing.webp`, {
          headers: { 'x-forwarded-for': `203.0.113.${index}`, 'x-real-ip': `198.51.100.${index}` },
        });
        expect(response.status).toBe(404);
      }
      const limited = await fetch(`${server.baseUrl}/images/private/missing.webp`, {
        headers: { 'x-forwarded-for': '198.51.100.20', 'x-real-ip': '203.0.113.20' },
      });
      expect(limited.status).toBe(429);
    } finally {
      await server.close();
    }
  });

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
