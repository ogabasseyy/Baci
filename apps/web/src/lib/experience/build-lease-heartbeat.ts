/** Lease loss is sticky; never revive an attempt after an uncertain renewal. */
export function startBuildLeaseHeartbeat(
  renew: () => Promise<boolean>,
  intervalMs = 120000,
  timeoutMs = 30000,
  signal?: AbortSignal
) {
  let lost = false;
  let stopped = false;
  let pending: Promise<void> | undefined;
  const tick = () => {
    if (stopped || lost || pending) return;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    pending = Promise.race([
      Promise.resolve().then(() => (stopped ? false : renew())),
      new Promise<boolean>((_, reject) => {
        deadline = setTimeout(
          () => reject(Error('BUILD_LEASE_TIMEOUT')),
          timeoutMs
        );
      }),
    ])
      .then((held) => {
        if (!held) lost = true;
      })
      .catch(() => {
        lost = true;
      })
      .finally(() => {
        clearTimeout(deadline);
        pending = undefined;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  const stopRenewing = () => {
    stopped = true;
    clearInterval(timer);
  };
  if (signal?.aborted) stopRenewing();
  else signal?.addEventListener('abort', stopRenewing, { once: true });
  return {
    async assertHeld() {
      if (stopped || lost) throw Error('BUILD_LEASE_LOST');
      if (pending) await pending;
      if (!lost) {
        tick();
        await pending;
      }
      if (lost || stopped) throw Error('BUILD_LEASE_LOST');
    },
    async stop() {
      stopRenewing();
      signal?.removeEventListener('abort', stopRenewing);
      await pending;
    },
  };
}
