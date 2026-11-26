import { expect, it, vi } from 'vitest';
import { startProductionRunner } from './production-start';

const config = {
  key: Buffer.alloc(32, 2).toString('base64url'),
  toolchainDigest: 'a'.repeat(64),
  loopbackPort: 43182,
};
it('only opens the loopback bridge after qualified socket startup and closes both', async () => {
  const events: string[] = [];
  const startSocket = vi.fn(async () => {
    events.push('qualified');
    return {
      close: async () => {
        events.push('socket closed');
      },
    };
  });
  const startLoopback = vi.fn(async () => {
    events.push('loopback');
    return {
      origin: 'http://127.0.0.1:43182',
      close: async () => {
        events.push('loopback closed');
      },
    };
  });
  const service = await startProductionRunner(config, {
    startSocket,
    startLoopback,
    waitForReplayWindow: async () => {
      events.push('replay window elapsed');
    },
  });
  expect(events).toEqual(['replay window elapsed', 'qualified', 'loopback']);
  await service.close();
  expect(events).toEqual([
    'replay window elapsed',
    'qualified',
    'loopback',
    'loopback closed',
    'socket closed',
  ]);
});
it('closes the qualified socket if opening the loopback bridge fails', async () => {
  const close = vi.fn(async () => {});
  await expect(
    startProductionRunner(config, {
      startSocket: async () => ({ close }),
      startLoopback: async () => {
        throw Error('private error');
      },
      waitForReplayWindow: async () => {},
    })
  ).rejects.toThrow('RUNNER_STARTUP_FAILED');
  expect(close).toHaveBeenCalledOnce();
});

it('does not open any listener until old signed requests have expired', async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const startSocket = vi.fn(async () => ({ close: async () => {} }));
  const startLoopback = vi.fn(async () => ({
    origin: 'http://127.0.0.1:43182',
    close: async () => {},
  }));
  const starting = startProductionRunner(config, {
    startSocket,
    startLoopback,
    waitForReplayWindow: () => wait,
  });
  await Promise.resolve();
  expect(startSocket).not.toHaveBeenCalled();
  expect(startLoopback).not.toHaveBeenCalled();
  release();
  const service = await starting;
  await service.close();
});
