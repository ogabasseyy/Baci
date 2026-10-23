// @vitest-environment node
import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';

it('serves the advertised OAuth MCP transport path without a proxy rewrite', async () => {
  const merchant = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  const database = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url?.startsWith('/rest/v1/merchants') ? { id: merchant } : []));
  });
  await new Promise<void>((resolve) => database.listen(0, '127.0.0.1', resolve));
  const address = database.address();
  if (!address || typeof address === 'string') throw new Error('No test database');
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  let server: Awaited<ReturnType<typeof mcpServerTestSupport.startMcpServer>> | undefined;
  try {
    server = await mcpServerTestSupport.startMcpServer({
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
      MCP_PUBLIC_ORIGIN: 'https://qa.example.com',
      BACI_MCP_GUEST_OAUTH_ENABLED: 'true', MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS: 'false',
      MCP_CANONICAL_CART_BRIDGE_URL: 'https://ogabassey.test/api/storefront/cart/legacy',
      MCP_CANONICAL_CART_BRIDGE_ALLOWED_ORIGINS: 'https://ogabassey.test',
      MCP_GUEST_OAUTH_RESOURCE_URL: 'https://qa.example.com/submission/mcp',
      MCP_GUEST_OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      MCP_GUEST_OAUTH_REDIRECT_URIS: JSON.stringify(['https://chatgpt.com/connector_platform_oauth_redirect']),
      MCP_GUEST_OAUTH_WORKER_TOKEN: `${encode({ alg: 'HS256' })}.${encode({ role: 'mcp_guest_oauth_worker', merchant_id: merchant, exp: Date.now() / 1000 + 259200 })}.test`,
    });
    const response = await fetch(`${server.baseUrl}/submission/mcp`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('oauth-protected-resource');
    expect((await fetch(`${server.baseUrl}/submission/mcp`, { method: 'OPTIONS' })).status).toBe(204);
    expect((await fetch(`${server.baseUrl}/mcp`, { method: 'POST' })).status).toBe(404);
    const metadata = await fetch(`${server.baseUrl}/.well-known/oauth-protected-resource/submission/mcp`);
    expect(await metadata.json()).toMatchObject({ resource: 'https://qa.example.com/submission/mcp' });
  } finally {
    if (server) await mcpServerTestSupport.stopMcpServer(server.process);
    await new Promise<void>((resolve) => database.close(() => resolve()));
  }
}, 20_000);
