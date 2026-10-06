import { expect, it, vi } from 'vitest';
import { runReplayDaemon } from './replay-daemon';

it('reloads configuration each pass and publishes a heartbeat only after completion', async () => {
  const controller = new AbortController();
  const order: string[] = [];
  await runReplayDaemon({
    signal: controller.signal,
    read: async () => {
      order.push('read');
      return {};
    },
    run: async () => {
      order.push('run');
    },
    heartbeat: async () => {
      order.push('heartbeat');
    },
    report: vi.fn(),
    wait: async () => {
      controller.abort();
    },
  });
  expect(order).toEqual(['read', 'run', 'heartbeat']);
});

it('never publishes a healthy heartbeat after a failed pass', async () => {
  const controller = new AbortController();
  const heartbeat = vi.fn();
  const report = vi.fn();
  await runReplayDaemon({
    signal: controller.signal,
    read: async () => ({}),
    run: async () => {
      throw new Error('secret');
    },
    heartbeat,
    report,
    wait: async () => {
      controller.abort();
    },
  });
  expect(heartbeat).not.toHaveBeenCalled();
  expect(report).toHaveBeenCalledWith('pass-failed');
});
