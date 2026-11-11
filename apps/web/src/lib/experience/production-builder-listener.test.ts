// @vitest-environment node
import { once } from 'node:events';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { installBuilderGateway } from '@/lib/builder-gateway/runtime';
import { createProductionBuilderListener } from './production-builder-listener';

it('verifies a broker-signed token and delivers the MCP request to the installed local gateway', async () => {
  const key = await generateKeyPair('ES256');
  const jwk = {
    ...(await exportJWK(key.publicKey)),
    kid: 'fixture',
    alg: 'ES256',
  };
  const token = await new SignJWT({
    connectionId: '20000000-0000-4000-8000-000000000001',
    grantVersion: 1,
    scope: 'storefront.read',
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'fixture', typ: 'at+jwt' })
    .setIssuer('https://mcp.usebaci.com')
    .setAudience('https://mcp.usebaci.com/builder/mcp')
    .setSubject('10000000-0000-4000-8000-000000000001')
    .setExpirationTime('5m')
    .sign(key.privateKey);
  const gateway = vi.fn(async (request: Request, tool: string) => {
    expect(request.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(tool).toBe('list_storefronts');
    return Response.json({ stores: [], nextCursor: null });
  });
  const uninstall = installBuilderGateway(gateway);
  const listener = createProductionBuilderListener({ keys: [jwk] });
  listener.server.listen(0, '127.0.0.1');
  await once(listener.server, 'listening');
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('fixture');
    const post = (bearer: string) =>
      fetch(`http://127.0.0.1:${address.port}/builder/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_storefronts', arguments: {} },
        }),
      });
    expect((await post('invalid.token')).status).toBe(401);
    expect(gateway).not.toHaveBeenCalled();
    const result = await post(token);
    expect(result.status).toBe(200);
    expect(gateway).toHaveBeenCalledOnce();
  } finally {
    await listener.close();
    uninstall();
  }
});
