// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const f = vi.hoisted(() => ({ host: vi.fn(), listener: vi.fn() }));
vi.mock('./production-builder-host', () => ({
  startProductionBuilderHost: f.host,
}));
vi.mock('./production-builder-listener', () => ({
  createProductionBuilderListener: f.listener,
}));

import { startProductionBuilderStack } from './production-builder-stack';

it('starts the listener on loopback after the host, then closes listener before host', async () => {
  const calls: string[] = [];
  const jwks = { keys: [] };
  const closeHost = vi.fn(async () => {
    calls.push('host');
  });
  const closeListener = vi.fn(async () => {
    calls.push('listener');
  });
  const server = {
    listen: vi.fn((_port, _host, callback) => callback()),
    once: vi.fn(),
    off: vi.fn(),
  };
  f.host.mockResolvedValue({
    publicJwks: jwks,
    deliver: vi.fn(),
    close: closeHost,
  });
  f.listener.mockReturnValue({ server, close: closeListener });
  const stack = await startProductionBuilderStack({
    host: {} as never,
    port: 8790,
  });
  expect(f.listener).toHaveBeenCalledWith(jwks);
  expect(server.listen).toHaveBeenCalledWith(
    8790,
    '127.0.0.1',
    expect.any(Function)
  );
  await Promise.all([stack.close(), stack.close()]);
  expect(calls).toEqual(['listener', 'host']);
});

it('closes the host if listener construction fails and rejects invalid ports before startup', async () => {
  const close = vi.fn(async () => {});
  f.host.mockClear().mockResolvedValue({ publicJwks: { keys: [] }, close });
  f.listener.mockImplementationOnce(() => {
    throw Error('private detail');
  });
  await expect(
    startProductionBuilderStack({ host: {} as never, port: 8790 })
  ).rejects.toThrow('BUILDER_STACK_STARTUP_FAILED');
  expect(close).toHaveBeenCalledOnce();
  f.host.mockClear();
  await expect(
    startProductionBuilderStack({ host: {} as never, port: 0 })
  ).rejects.toThrow('INVALID_LISTENER_PORT');
  expect(f.host).not.toHaveBeenCalled();
});

it('closes both components if the loopback listener cannot bind', async () => {
  const closeHost = vi.fn(async () => {});
  const closeListener = vi.fn(async () => {});
  let fail: ((error: Error) => void) | undefined;
  const server = {
    once: vi.fn((_event: string, callback: (error: Error) => void) => {
      fail = callback;
    }),
    off: vi.fn(),
    listen: vi.fn(() => {
      fail?.(Error('address in use'));
    }),
  };
  f.host.mockResolvedValue({ publicJwks: { keys: [] }, close: closeHost });
  f.listener.mockReturnValue({ server, close: closeListener });
  await expect(
    startProductionBuilderStack({ host: {} as never, port: 8790 })
  ).rejects.toThrow('BUILDER_STACK_STARTUP_FAILED');
  expect(closeListener).toHaveBeenCalledOnce();
  expect(closeHost).toHaveBeenCalledOnce();
});
