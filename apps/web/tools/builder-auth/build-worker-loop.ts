/** Scheduler is supplied by the operator; importing this module starts nothing. */
export function startBuildWorkerLoop(settings: {
  runOnce(cursor: string | null): Promise<{ cursor: string | null }>;
  schedule(callback: () => void): () => void;
}) {
  let cursor: string | null = null;
  let pending: Promise<void> | undefined;
  let stopped = false;
  const cancel = settings.schedule(() => {
    if (stopped || pending) return;
    pending = settings
      .runOnce(cursor)
      .then((result) => {
        cursor = result.cursor;
      })
      .catch(() => {
        // Errors can contain credentials or merchant data; log a fixed signal only.
        console.error('BUILD_WORKER_TICK_FAILED');
      })
      .finally(() => {
        pending = undefined;
      });
  });
  return async () => {
    stopped = true;
    cancel();
    await pending;
  };
}
