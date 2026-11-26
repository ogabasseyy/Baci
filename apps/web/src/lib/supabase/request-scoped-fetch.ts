/** Preserve the SDK's per-call signal alongside the enclosing request signal. */
export function requestScopedFetch(signal: AbortSignal): typeof fetch {
  return (input, init) => {
    const fetchSignal =
      init?.signal !== undefined
        ? init.signal
        : input instanceof Request
          ? input.signal
          : undefined;
    return fetch(input, {
      ...init,
      signal: fetchSignal ? AbortSignal.any([signal, fetchSignal]) : signal,
    });
  };
}
