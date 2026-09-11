const RETRY_EVENTS = [
  'pointerdown',
  'touchstart',
  'keydown',
  'pageshow',
] as const;

export function loadStylesheetAfterWindowLoad(
  load: () => Promise<unknown>,
  errorMessage: string
): () => void {
  let cancelled = false;
  let started = false;

  const stopRetry = () => {
    for (const eventName of RETRY_EVENTS) {
      window.removeEventListener(eventName, run);
    }
  };

  const armRetry = () => {
    for (const eventName of RETRY_EVENTS) {
      window.addEventListener(eventName, run, { once: true, passive: true });
    }
  };

  const run = () => {
    if (cancelled || started) {
      return;
    }

    started = true;
    window.removeEventListener('load', run);
    stopRetry();
    load().catch((error: unknown) => {
      console.error(new Error(errorMessage, { cause: error }));
      if (cancelled) {
        return;
      }
      started = false;
      armRetry();
    });
  };

  if (document.readyState === 'complete') {
    run();
  } else {
    window.addEventListener('load', run);
  }

  return () => {
    cancelled = true;
    window.removeEventListener('load', run);
    stopRetry();
  };
}
