import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAfter = vi.fn();
const mockWaitUntil = vi.fn();

vi.mock('next/server', () => ({
  after: (pending: Promise<unknown>) => mockAfter(pending),
}));
vi.mock('@vercel/functions', () => ({
  waitUntil: (pending: Promise<unknown>) => mockWaitUntil(pending),
}));

const { createBackgroundRefresher } = await import('./background-refresh');

describe('createBackgroundRefresher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs one refresh per key at a time', async () => {
    const refresh = vi.fn(() => new Promise(() => undefined));
    const run = createBackgroundRefresher('Test');
    run('a', refresh);
    run('a', refresh);
    run('b', refresh);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('keeps the instance alive through the Next.js request when there is one', () => {
    createBackgroundRefresher('Test')('a', async () => undefined);
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockWaitUntil).not.toHaveBeenCalled();
  });

  it('falls back to the platform keep-alive outside a request scope', () => {
    mockAfter.mockImplementation(() => {
      throw new Error('outside a request scope');
    });
    createBackgroundRefresher('Test')('a', async () => undefined);
    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
  });

  it('still runs the refresh when nothing can keep the instance alive', async () => {
    mockAfter.mockImplementation(() => {
      throw new Error('outside a request scope');
    });
    mockWaitUntil.mockImplementation(() => {
      throw new Error('no request context');
    });
    const refresh = vi.fn(async () => undefined);
    createBackgroundRefresher('Test')('a', refresh);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('logs a failed refresh instead of rejecting', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    let handed: Promise<unknown> = Promise.resolve();
    const run = createBackgroundRefresher('Test', (pending) => {
      handed = pending;
    });
    run('a', async () => {
      throw new Error('database down');
    });
    await expect(handed).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(
      '[Background Refresh] Refresh failed',
      expect.objectContaining({ key: 'a', label: 'Test' })
    );
  });
});
