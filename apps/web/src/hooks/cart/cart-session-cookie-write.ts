import { withCartCookieWrite } from './cart-cross-tab-lock';
import { CART_REQUEST_TIMEOUT_MS } from './cart-request-deadline';
import { runCartSessionWrite } from './cart-session-write-fence';

/** Fence a cookie-setting request until its response has actually settled. */
export function runCartSessionCookieWrite<T>(
  slug: string | null | undefined,
  blocked: T,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  // Without Web Locks, cookie responses cannot be ordered across tabs safely.
  if (typeof navigator === 'undefined' || !navigator.locks)
    return Promise.resolve(blocked);
  return runCartSessionWrite(slug, blocked, () => {
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    const timer = setTimeout(abortRequest, CART_REQUEST_TIMEOUT_MS);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', abortRequest, { once: true });
    }
    // The request deadline cancels fetch, while this signal keeps the cookie
    // lock held until the aborted or completed response has settled.
    const fenceSignal = new AbortController().signal;
    return (async () => {
      try {
        return await withCartCookieWrite(
          blocked,
          fenceSignal,
          () => operation(requestController.signal),
          slug
        );
      } finally {
        clearTimeout(timer);
        if (typeof window !== 'undefined') {
          window.removeEventListener('pagehide', abortRequest);
        }
      }
    })();
  });
}
