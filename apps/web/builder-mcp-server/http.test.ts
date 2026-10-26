// @vitest-environment node
import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createBuilderMcpHttpHandler } from './http';
import { BUILDER_METADATA_PATH } from './metadata';

it.each([
  true,
  false,
])('trusts forwarded rate-limit identities only for configured proxy peers (%s)', async (trusted) => {
  const handler = createBuilderMcpHttpHandler({
    executeBuilderTool: vi.fn(),
    verifyAccessToken: vi.fn(),
    trustedProxies: trusted ? ['127.0.0.1'] : [],
  });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  const request = (ip: string) =>
    fetch(`http://127.0.0.1:${address.port}${BUILDER_METADATA_PATH}`, {
      headers: { 'x-forwarded-for': ip },
    });
  try {
    for (let i = 0; i < 120; i++) {
      const response = await request('192.0.2.1');
      expect(response.status).toBe(200);
      await response.text();
    }
    const blocked = await request('192.0.2.1');
    expect(blocked.status).toBe(429);
    await blocked.text();
    const other = await request('192.0.2.2');
    expect(other.status).toBe(trusted ? 200 : 429);
    await other.text();
  } finally {
    await handler.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
