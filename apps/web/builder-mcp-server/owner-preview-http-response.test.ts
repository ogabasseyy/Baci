// @vitest-environment node

import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import {
  createOwnerPreviewHttpHandler,
  send,
} from './owner-preview-http.test-support';

it('does not forward an oversized bridge response', async () => {
  const handler = createOwnerPreviewHttpHandler(
    async () => new Response('x'.repeat(300000))
  );
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    const response = await send(address.port);
    expect(response.status).toBe(502);
    expect(response.body).toBe('{}');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('does not expose unexpected inner bridge statuses', async () => {
  const handler = createOwnerPreviewHttpHandler(
    async () => new Response(null, { status: 302 })
  );
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    expect((await send(address.port)).status).toBe(502);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
