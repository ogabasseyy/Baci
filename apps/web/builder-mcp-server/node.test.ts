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
