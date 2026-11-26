import { createServer } from 'node:net';
import { expect, it, vi } from 'vitest';
import { startAuthQualification } from './auth-qualification';

async function listenOnTestPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null)
    throw Error('Test listener missing address');
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

it('rejects an invalid port before starting a broker', async () => {
  const start = vi.fn();
  await expect(startAuthQualification(-1, start)).rejects.toThrow(
    'INVALID_AUTH_QUALIFICATION_PORT'
  );
  expect(start).not.toHaveBeenCalled();
});

it('closes the broker if the loopback port is in use', async () => {
  const occupied = await listenOnTestPort();
  const close = vi.fn().mockResolvedValue(undefined);
  try {
    await expect(
      startAuthQualification(occupied.port, async () => ({
        socketPath: '/unused.sock',
        close,
      }))
    ).rejects.toThrow('AUTH_QUALIFICATION_STARTUP_FAILED');
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await occupied.close();
  }
});
