import type { DashboardLayoutConfig } from '@/components/analytics/analytics-grid-layout-hydration';

export type DashboardLayoutSave = (
  layout: DashboardLayoutConfig,
  merchantId?: string,
  signal?: AbortSignal
) => Promise<void>;

export interface DashboardLayoutSaveQueue {
  enqueue(layout: DashboardLayoutConfig, merchantId?: string): Promise<void>;
  reset(): Promise<void>;
}

/**
 * Serializes layout writes and invalidates unstarted work when the selected
 * merchant or category changes. An in-flight request must be allowed to settle:
 * aborting the browser request cannot prove that the server did not commit its
 * upsert, and starting the next write early could therefore restore stale data.
 */
export function createDashboardLayoutSaveQueue(
  save: DashboardLayoutSave
): DashboardLayoutSaveQueue {
  let tail: Promise<void> = Promise.resolve();
  let generation = 0;
  let controller = new AbortController();

  return {
    enqueue(layout, merchantId) {
      const requestGeneration = generation;
      const requestController = controller;
      const task = tail
        .catch(() => undefined)
        .then(() => {
          if (
            requestGeneration !== generation ||
            requestController.signal.aborted
          ) {
            return;
          }
          return save(layout, merchantId, requestController.signal);
        });
      tail = task.catch(() => undefined);
      return task;
    },
    reset() {
      generation += 1;
      // Do not abort the current controller. The server may finish an upsert
      // after the aborted fetch rejects, so the next generation must remain
      // behind the existing tail until that response is known to have settled.
      // The generation check above still discards every old task not yet begun.
      controller = new AbortController();
      return tail.catch(() => undefined);
    },
  };
}
