'use client';
// Uses browser document visibility events to resume client cart work.

/** Own one foreground listener so link restarts and unmounts can cancel it. */
export function createCartVisibilityWaiter() {
  let remove: (() => void) | undefined;
  function cancel() {
    remove?.();
    remove = undefined;
  }
  function wait(callback: () => void) {
    cancel();
    const onVisible = () => {
      if (document.hidden) return;
      cancel();
      callback();
    };
    remove = () => document.removeEventListener('visibilitychange', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    // The tab may have become visible between the caller's hidden check
    // and this registration; no further event would fire in that case.
    if (!document.hidden) onVisible();
  }
  return { wait, cancel };
}
