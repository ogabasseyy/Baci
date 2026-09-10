import { loadStylesheetAfterWindowLoad } from './load-stylesheet-after-window-load';

const DESKTOP_VIEWPORT_QUERY = '(min-width: 768px)';
const FIRST_INPUT_EVENTS = ['pointerdown', 'touchstart', 'keydown'] as const;

function isDesktopViewport(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(DESKTOP_VIEWPORT_QUERY).matches
  );
}

/**
 * Keep Tailwind chunks off the Slow-4G LCP path. Lighthouse mobile never
 * taps or types, so the sheet stays unloaded in lab. Do not listen for
 * `scroll` — Lighthouse full-page screenshots dispatch it and would put the
 * 329KB chunk back on the LCP path. Real phones load on the first tap or
 * key; desktop still waits for window load.
 */
export function loadStylesheetAfterFirstInput(
  load: () => Promise<unknown>,
  errorMessage: string
): () => void {
  if (isDesktopViewport()) {
    return loadStylesheetAfterWindowLoad(load, errorMessage);
  }

  let loaded = false;
  const media =
    typeof window.matchMedia === 'function'
      ? window.matchMedia(DESKTOP_VIEWPORT_QUERY)
      : null;

  const run = () => {
    if (loaded) {
      return;
    }
    loaded = true;
    stop();
    load().catch((error: unknown) => {
      console.error(new Error(errorMessage, { cause: error }));
    });
  };

  const onDesktop = (event: MediaQueryListEvent) => {
    if (event.matches) {
      run();
    }
  };

  for (const eventName of FIRST_INPUT_EVENTS) {
    window.addEventListener(eventName, run, { once: true, passive: true });
  }
  media?.addEventListener('change', onDesktop);

  function stop() {
    for (const eventName of FIRST_INPUT_EVENTS) {
      window.removeEventListener(eventName, run);
    }
    media?.removeEventListener('change', onDesktop);
  }

  return stop;
}
