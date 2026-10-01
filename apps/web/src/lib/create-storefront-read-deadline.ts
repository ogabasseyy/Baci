export function createStorefrontReadDeadline(timeoutMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException(
        'The storefront read timed out',
        'TimeoutError'
      );
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  return {
    cleanup: () => {
      if (timer) clearTimeout(timer);
    },
    promise,
    signal: controller.signal,
  };
}
