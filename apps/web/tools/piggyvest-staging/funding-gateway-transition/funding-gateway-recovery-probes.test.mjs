import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { requestStatus } from './funding-gateway-recovery-probes.mjs';

it('resolves the status code of a reachable endpoint', async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 204;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const status = await requestStatus({
      host: '127.0.0.1',
      port: typeof address === 'object' && address ? address.port : 0,
      path: '/health',
    });
    expect(status).toBe(204);
  } finally {
    server.close();
  }
});

it('rejects when nothing listens', async () => {
  await expect(
    requestStatus({ host: '127.0.0.1', port: 1, path: '/' })
  ).rejects.toThrow();
});
