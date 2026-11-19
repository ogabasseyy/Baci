type RequestDeadlineOptions = {
  timeoutMs: number;
  timeoutMessage: string;
  parentSignal?: AbortSignal;
};

function abortReason(signal: AbortSignal, cause?: unknown) {
  return signal.reason ?? cause;
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  const observedPromise = Promise.resolve(promise);
  if (signal.aborted) {
    observedPromise.catch(() => undefined);
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    observedPromise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (cause: unknown) => {
        cleanup();
        reject(cause);
      }
    );
  });
}

async function runWithRequestDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  options: RequestDeadlineOptions
): Promise<T> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(options.parentSignal?.reason);
  if (options.parentSignal?.aborted) abortFromParent();
  else
    options.parentSignal?.addEventListener('abort', abortFromParent, {
      once: true,
    });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException(options.timeoutMessage, 'TimeoutError')
      ),
    options.timeoutMs
  );
  const requestPromise = Promise.resolve().then(() => {
    if (controller.signal.aborted) {
      throw abortReason(controller.signal);
    }
    return request(controller.signal);
  });
  try {
    return await raceWithAbort(requestPromise, controller.signal);
  } finally {
    clearTimeout(timeout);
    options.parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

export const requestDeadline = { run: runWithRequestDeadline };
