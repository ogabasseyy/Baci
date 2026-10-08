import { afterEach, expect, it, vi } from 'vitest';
import {
  SHUTDOWN_DRAIN_TIMEOUT_MS,
  createGracefulShutdown,
} from './server-shutdown';

afterEach(() => {
  vi.useRealTimers();
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

it('forces lock release when the drain never finishes', () => {
  vi.useFakeTimers();
  const order: string[] = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const shutdown = createGracefulShutdown({
    closeServer: () => {
      order.push('close');
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
  vi.advanceTimersByTime(SHUTDOWN_DRAIN_TIMEOUT_MS);
  expect(order).toEqual(['close', 'release', 'exit:0']);
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining('shutdown-timeout')
  );
});
