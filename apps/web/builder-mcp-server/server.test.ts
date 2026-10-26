// @vitest-environment node

import { once } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createBuilderMcpHttpHandler } from './http';

async function fixture() {
  const executeBuilderTool = vi
    .fn()
    .mockResolvedValue({ stores: [], nextCursor: null });
  const verifyAccessToken = vi.fn(async (token: string) => {
    if (token === 'expired') throw Error('invalid');
  });
  const handler = createBuilderMcpHttpHandler({
    executeBuilderTool,
    verifyAccessToken,
  });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    executeBuilderTool,
    verifyAccessToken,
    handler,
    close: async () => {
      await handler.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
async function post(
  url: string,
  body: unknown,
  token?: string,
  extra: Record<string, string> = {}
) {
  return fetch(`${url}/builder/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
describe('stateless builder Streamable HTTP', () => {
  it('initializes and discovers schemas anonymously, without session affinity or data', async () => {
    const f = await fixture();
    try {
      const r = await post(f.url, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'fixture', version: '1' },
        },
      });
      expect(r.status).toBe(200);
      expect(r.headers.get('mcp-session-id')).toBeNull();
      expect((await r.json()).result.serverInfo.name).toBe(
        'Baci website builder'
      );
      expect(f.executeBuilderTool).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
  it('returns transport auth challenges for expired tokens and protected GET', async () => {
    const f = await fixture();
    try {
      for (const r of [
        await post(
          f.url,
          { jsonrpc: '2.0', id: 1, method: 'tools/list' },
          'expired'
        ),
        await fetch(`${f.url}/builder/mcp`),
      ]) {
        expect(r.status).toBe(401);
        expect(r.headers.get('www-authenticate')).toContain(
          'resource_metadata'
        );
      }
      expect(f.executeBuilderTool).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
  it('keeps bearer context per request; a spoofed session cannot grant access', async () => {
    const f = await fixture();
    try {
      const rpc = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_storefronts', arguments: {} },
      };
      await Promise.all([post(f.url, rpc, 'one'), post(f.url, rpc, 'two')]);
      expect(f.executeBuilderTool.mock.calls.map((c) => c[0]).sort()).toEqual([
        'one',
        'two',
      ]);
      expect(
        (await post(f.url, rpc, undefined, { 'mcp-session-id': 'one' })).status
      ).toBe(400);
      const r = await post(f.url, rpc);
      expect((await r.json()).result.isError).toBe(true);
    } finally {
      await f.close();
    }
  });
  it('rejects malformed/oversized input, foreign Origin and shutdown requests', async () => {
    const f = await fixture();
    try {
      expect((await post(f.url, '{')).status).toBe(400);
      expect((await post(f.url, 'x'.repeat(70000))).status).toBe(413);
      expect(
        (await post(f.url, {}, undefined, { origin: 'https://evil.test' }))
          .status
      ).toBe(403);
      await f.handler.close();
      expect((await post(f.url, {})).status).toBe(503);
    } finally {
      await f.close();
    }
  });
});

it('retains OpenAI securitySchemes on the raw wire, independent of SDK client extension stripping', async () => {
  const f = await fixture();
  try {
    const response = await post(f.url, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/list',
    });
    const tool = (await response.json()).result.tools[0];
    expect(tool.securitySchemes).toEqual([
      { type: 'oauth2', scopes: ['storefront.read'] },
    ]);
    expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
  } finally {
    await f.close();
  }
});
it('keeps structured output object-shaped with the real SDK over stateless HTTP', async () => {
  const { Client, StreamableHTTPClientTransport } = await import(
    '@modelcontextprotocol/client'
  );
  const f = await fixture();
  const client = new Client({ name: 'real-http-fixture', version: '1' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${f.url}/builder/mcp`), {
        requestInit: { headers: { authorization: 'Bearer fixture' } },
      })
    );
    await client.listTools();
    const result = await client.callTool({
      name: 'list_storefronts',
      arguments: {},
    });
    expect(result.structuredContent).toEqual({ stores: [], nextCursor: null });
  } finally {
    await client.close();
    await f.close();
  }
});
