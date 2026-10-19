import { describe, expect, it, vi } from 'vitest';
import { runReplaySchedule } from './replay-runtime';

describe('staging replay schedule', () => {
  it('finishes each bounded pass before waiting and starting the next', async () => {
    const controller = new AbortController();
    const order: string[] = [];
    const run = vi.fn(async () => {
      order.push('run');
    });
    const wait = vi.fn(async () => {
      order.push('wait');
      if (run.mock.calls.length === 2) controller.abort();
    });
    await runReplaySchedule({
      run,
      wait,
      signal: controller.signal,
      report: vi.fn(),
    });
    expect(order).toEqual(['run', 'wait', 'run', 'wait']);
    expect(wait).toHaveBeenCalledWith(60_000, controller.signal);
  });

  it('reports a sanitized failure and backs off without leaking exception text', async () => {
    const controller = new AbortController();
    const report = vi.fn();
    const wait = vi.fn(async () => {
      controller.abort();
    });
    await runReplaySchedule({
      run: async () => {
        throw new Error('sensitive payload');
      },
      wait,
      signal: controller.signal,
      report,
    });
    expect(report).toHaveBeenCalledWith('pass-failed');
    expect(wait).toHaveBeenCalledWith(300_000, controller.signal);
    expect(JSON.stringify(report.mock.calls)).not.toContain('sensitive');
  });

  it('does not start work after shutdown', async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn();
    await runReplaySchedule({
      run,
      wait: vi.fn(),
      signal: controller.signal,
      report: vi.fn(),
    });
    expect(run).not.toHaveBeenCalled();
  });
});
