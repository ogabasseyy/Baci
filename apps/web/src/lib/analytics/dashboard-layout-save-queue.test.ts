import { describe, expect, it, vi } from 'vitest';
import {
  createDashboardLayoutSaveQueue,
  type DashboardLayoutSave,
} from './dashboard-layout-save-queue';

const layout = { lg: [{ h: 1, i: 'sales', w: 2, x: 0, y: 0 }] };

describe('createDashboardLayoutSaveQueue', () => {
  it('waits for an earlier write before sending the latest layout', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const save = vi.fn<DashboardLayoutSave>(async () => {
      if (save.mock.calls.length === 1) await firstFinished;
    });
    const queue = createDashboardLayoutSaveQueue(save);

    const first = queue.enqueue(layout);
    const secondLayout = {
      ...layout,
      lg: [{ ...layout.lg[0], x: 4 }],
    };
    const second = queue.enqueue(secondLayout);
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await Promise.all([first, second]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toEqual(secondLayout);
  });

  it('does not write queued layouts from a previous merchant or category', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const save = vi.fn<DashboardLayoutSave>(async () => {
      if (save.mock.calls.length === 1) await firstFinished;
    });
    const queue = createDashboardLayoutSaveQueue(save);

    const oldFirst = queue.enqueue(layout, 'merchant-old');
    const oldSecond = queue.enqueue(layout, 'merchant-old');
    await Promise.resolve();
    await Promise.resolve();
    queue.reset();
    const next = queue.enqueue(layout, 'merchant-new');

    releaseFirst?.();
    await Promise.all([oldFirst, oldSecond, next]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0]?.[1]).toBe('merchant-old');
    expect(save.mock.calls[1]?.[1]).toBe('merchant-new');
  });

  it('does not finish a category reset before an in-flight save settles', async () => {
    let releaseSave: (() => void) | undefined;
    const saveFinished = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const queue = createDashboardLayoutSaveQueue(async () => saveFinished);
    const write = queue.enqueue(layout, 'merchant-1');
    await Promise.resolve();
    let resetFinished = false;
    const reset = queue.reset().then(() => {
      resetFinished = true;
    });

    await Promise.resolve();
    expect(resetFinished).toBe(false);

    releaseSave?.();
    await Promise.all([write, reset]);
    expect(resetFinished).toBe(true);
  });

  it('does not abort an in-flight upsert before a newer generation write', async () => {
    let releaseOldWrite: (() => void) | undefined;
    const oldWriteFinished = new Promise<void>((resolve) => {
      releaseOldWrite = resolve;
    });
    let oldSignal: AbortSignal | undefined;
    const save = vi.fn<DashboardLayoutSave>(
      async (_layout, merchantId, signal) => {
        if (merchantId === 'merchant-old') {
          oldSignal = signal;
          await oldWriteFinished;
        }
      }
    );
    const queue = createDashboardLayoutSaveQueue(save);

    const oldWrite = queue.enqueue(layout, 'merchant-old');
    await Promise.resolve();
    await Promise.resolve();
    const reset = queue.reset();
    const newLayout = { lg: [{ ...layout.lg[0], x: 6 }] };
    const newWrite = queue.enqueue(newLayout, 'merchant-new');

    expect(oldSignal?.aborted).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);

    releaseOldWrite?.();
    await Promise.all([oldWrite, reset, newWrite]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.slice(0, 2)).toEqual([
      newLayout,
      'merchant-new',
    ]);
  });
});
