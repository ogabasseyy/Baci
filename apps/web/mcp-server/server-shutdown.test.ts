import { afterEach, expect, it, vi } from 'vitest';
import { createGracefulShutdown } from './server-shutdown';

afterEach(() => {
  vi.restoreAllMocks();
});

it('releases locks only after the server finishes draining', () => {
  const order: string[] = [];
  let done: (() => void) | undefined;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const shutdown = createGracefulShutdown({
    closeServer: (finished) => {
      order.push('close');
      done = finished;
    },
    releaseLocks: () => {
      order.push('release');
    },
    exit: (code) => {
      order.push(`exit:${code}`);
    },
  });
  shutdown();
  expect(order).toEqual(['close']);
  done?.();
  expect(order).toEqual(['close', 'release', 'exit:0']);
});
