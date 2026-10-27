/** Bound cart authority requests, including CSRF preflight and response parsing. */
export const CART_REQUEST_TIMEOUT_MS = 15_000;
export async function withCartRequestDeadline<T>(
  fallback: T,
  request: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal
): Promise<T> {
  if (externalSignal?.aborted) return fallback;
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, CART_REQUEST_TIMEOUT_MS);
  const canceled = new Promise<T>((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(fallback), {
      once: true,
    });
  });
  try {
    return await Promise.race([request(controller.signal), canceled]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abort);
  }
}
