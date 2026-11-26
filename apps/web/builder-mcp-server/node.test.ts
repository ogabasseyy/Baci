// @vitest-environment node
import { once } from 'node:events';
import { request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { BUILDER_METADATA_PATH } from './metadata';
import { createBuilderMcpNodeServer } from './node';
import { createOwnerInternalNodeServer } from './owner-internal-node';

it('serves discovery on a real loopback listener and shuts down cleanly', async () => {
  const runtime = createBuilderMcpNodeServer();
  runtime.server.listen(0, '127.0.0.1');
  await once(runtime.server, 'listening');
  try {
    const address = runtime.server.address();
    if (!address || typeof address === 'string') throw Error('fixture');
    const response = await fetch(
      `http://127.0.0.1:${address.port}${BUILDER_METADATA_PATH}`
    );
    expect(response.status).toBe(200);
    const metadata = (await response.json()) as {
      authorization_servers: string[];
      resource: string;
    };
    expect(metadata.resource).toBe(
      'https://builder-mcp.usebaci.com/builder/mcp'
    );
    expect(metadata.authorization_servers).toEqual([
      'https://builder-auth.usebaci.com',
    ]);
    expect(runtime.server.requestTimeout).toBe(30000);
    expect(runtime.server.headersTimeout).toBe(10000);
  } finally {
    await runtime.close();
  }
  expect(runtime.server.listening).toBe(false);
  await runtime.close();
});

it.each([
  false,
  true,
])('advertises full-code tools through the normal listener only when enabled (%s)', async (enabled) => {
  const runtime = createBuilderMcpNodeServer({
    experience: enabled ? { enabled: true } : undefined,
  });
  runtime.server.listen(0, '127.0.0.1');
  await once(runtime.server, 'listening');
  try {
    const address = runtime.server.address();
    if (!address || typeof address === 'string') throw Error('fixture');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/builder/mcp`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(
      body.result.tools.some((tool) => tool.name === 'build_experience')
    ).toBe(enabled);
    expect(
      body.result.tools.some((tool) => tool.name === 'create_storefront_draft')
    ).toBe(true);
  } finally {
    await runtime.close();
  }
});

it('uses explicitly supplied trusted transport dependencies for a co-located gateway', async () => {
  const execute = vi.fn(async () => ({ stores: [], nextCursor: null }));
  const verify = vi.fn(async () => {});
  const runtime = createBuilderMcpNodeServer({
    executeBuilderTool: execute,
    verifyAccessToken: verify,
  });
  runtime.server.listen(0, '127.0.0.1');
  await once(runtime.server, 'listening');
  try {
    const address = runtime.server.address();
    if (!address || typeof address === 'string') throw Error('fixture');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/builder/mcp`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer synthetic.token',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_storefronts', arguments: {} },
        }),
      }
    );
    expect(response.status).toBe(200);
    expect(verify).toHaveBeenCalledWith('synthetic.token');
    expect(execute).toHaveBeenCalledWith(
      'synthetic.token',
      'list_storefronts',
      { pageSize: 20 },
      expect.any(AbortSignal)
    );
  } finally {
    await runtime.close();
  }
});

it('rejects owner handler configuration on the public MCP listener', () => {
  expect(() =>
    createBuilderMcpNodeServer({
      ownerPreview: async () => new Response(),
    } as never)
  ).toThrow('OWNER_ROUTES_FORBIDDEN');
  expect(() =>
    createBuilderMcpNodeServer({
      ownerAttestation: async () => new Response(),
    } as never)
  ).toThrow('OWNER_ROUTES_FORBIDDEN');
  expect(() =>
    createBuilderMcpNodeServer({
      ownerPublicVerification: async () => new Response(),
    } as never)
  ).toThrow('OWNER_ROUTES_FORBIDDEN');
});

it('allows unset owner options while rejecting inherited handlers', async () => {
  const runtime = createBuilderMcpNodeServer({
    ownerPreview: undefined,
    ownerAttestation: undefined,
    ownerPublicVerification: undefined,
  } as never);
  await runtime.close();
  expect(() =>
    createBuilderMcpNodeServer(Object.create({ ownerPreview: vi.fn() }))
  ).toThrow('OWNER_ROUTES_FORBIDDEN');
});

it('routes the internal owner preview only when explicitly installed', async () => {
  const ownerPreview = vi.fn(async () => Response.json({ ok: true }));
  const runtime = createOwnerInternalNodeServer({
    ownerPreview,
    ownerPreviewAdmission: (_body, _signature, reserve) =>
      reserve?.('synthetic-owner') ?? false,
  });
  const port = await runtime.listen(0);
  try {
    const response = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/internal/owner/preview',
          method: 'POST',
          headers: {
            host: 'owner.baci-internal.invalid',
            'content-type': 'application/json',
            'x-baci-owner-signature': 'a'.repeat(64),
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        }
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(response).toBe(200);
    expect(ownerPreview).toHaveBeenCalledOnce();
  } finally {
    await runtime.close();
  }
});

it('does not expose the owner preview route by default', async () => {
  const runtime = createBuilderMcpNodeServer();
  runtime.server.listen(0, '127.0.0.1');
  await once(runtime.server, 'listening');
  const address = runtime.server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/internal/owner/preview',
          method: 'POST',
          headers: {
            host: 'builder-mcp.usebaci.com',
            'content-type': 'application/json',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        }
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(404);
  } finally {
    await runtime.close();
  }
});
