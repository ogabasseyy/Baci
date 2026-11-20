/** Scheduler is supplied by the operator; importing this module starts nothing. */
export function startBuildWorkerLoop(settings: {
  runOnce(
    cursor: string | null,
    admission: AbortSignal
  ): Promise<{ cursor: string | null }>;
  schedule(callback: () => void): () => void;
}) {
  let cursor: string | null = null;
  let pending: Promise<void> | undefined;
  const admission = new AbortController();
  const cancel = settings.schedule(() => {
    if (admission.signal.aborted || pending) return;
    pending = settings
      .runOnce(cursor, admission.signal)
      .then((result) => {
        cursor = result.cursor;
      })
      .catch(() => {
        // Errors can contain credentials or merchant data; log a fixed signal only.
        if (!admission.signal.aborted)
          console.error('BUILD_WORKER_TICK_FAILED');
      })
      .finally(() => {
        pending = undefined;
      });
  });
  return async () => {
    admission.abort();
    cancel();
    await pending;
  };
}
