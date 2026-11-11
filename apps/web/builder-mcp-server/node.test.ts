// @vitest-environment node
import { once } from 'node:events';
import { expect, it } from 'vitest';
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
    expect(await response.json()).toBeTruthy();
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
