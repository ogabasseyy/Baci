// @vitest-environment node
import { once } from 'node:events';
import { request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { BUILDER_METADATA_PATH } from './metadata';
import { createBuilderMcpNodeServer } from './node';

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
    };
    expect(metadata.authorization_servers).toEqual(['https://mcp.usebaci.com']);
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

it('routes the internal owner preview only when explicitly installed', async () => {
  const ownerPreview = vi.fn(async () => Response.json({ ok: true }));
  const runtime = createBuilderMcpNodeServer({ ownerPreview });
  runtime.server.listen(0, '127.0.0.1');
  await once(runtime.server, 'listening');
  const address = runtime.server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    const response = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/internal/owner/preview',
          method: 'POST',
          headers: {
            host: 'mcp.usebaci.com',
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
    expect(response).toBe(200);
    expect(ownerPreview).toHaveBeenCalledOnce();
  } finally {
    await runtime.close();
  }
});

it('routes signed attestation only when explicitly installed', async () => {
  const ownerAttestation = vi.fn(async (req: Request) => {
    expect(req.url).toBe('https://verifier.baci-internal.invalid/v1/attest');
    expect(req.headers.get('x-baci-verifier-signature')).toBe('synthetic');
    expect(req.headers.get('cookie')).toBeNull();
    return new Response(null, { status: 204 });
  });
  const runtime = createBuilderMcpNodeServer({ ownerAttestation });
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
          path: '/internal/owner/attest',
          method: 'POST',
          headers: {
            host: 'mcp.usebaci.com',
            'content-type': 'application/json',
            'x-baci-verifier-signature': 'synthetic',
            cookie: 'secret=never-forward',
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
    expect(status).toBe(204);
    expect(ownerAttestation).toHaveBeenCalledOnce();
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
            host: 'mcp.usebaci.com',
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
