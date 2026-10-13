const MAX_STOREFRONT_BUILD_READS = 3;
let activeStorefrontBuildReads = 0;
const storefrontBuildReadWaiters: Array<{
  abort: () => void;
  resolve: () => void;
  signal?: AbortSignal | null;
}> = [];

function abortReason(signal: AbortSignal) {
  return (
    signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  );
}

async function acquireStorefrontBuildReadSlot(signal?: AbortSignal | null) {
  if (signal?.aborted) throw abortReason(signal);
  if (activeStorefrontBuildReads < MAX_STOREFRONT_BUILD_READS) {
    activeStorefrontBuildReads += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter = {
      abort: () => {
        if (!signal) return;
        const index = storefrontBuildReadWaiters.indexOf(waiter);
        if (index >= 0) storefrontBuildReadWaiters.splice(index, 1);
        reject(abortReason(signal));
      },
      resolve,
      signal,
    };
    storefrontBuildReadWaiters.push(waiter);
    signal?.addEventListener('abort', waiter.abort, { once: true });
  });
}

function releaseStorefrontBuildReadSlot() {
  const next = storefrontBuildReadWaiters.shift();
  if (next) {
    next.signal?.removeEventListener('abort', next.abort);
    next.resolve();
  } else activeStorefrontBuildReads -= 1;
}

/** Bounds public Supabase reads across clients in one build worker. */
export function createStorefrontBuildReadFetch(fetcher: typeof fetch) {
  return (async (...args: Parameters<typeof fetch>) => {
    const [input, init = {}] = args;
    await acquireStorefrontBuildReadSlot(init.signal);
    try {
      // A waiter released in the same tick its signal aborted must not issue
      // the fetch: post-abort calls reject with Next's "prerender complete"
      // error and squat on the slot while failing. Throw the abort reason
      // instead — the slot still releases via finally, so nothing leaks.
      if (init.signal?.aborted) throw abortReason(init.signal);
      return await fetcher(input, init);
    } finally {
      releaseStorefrontBuildReadSlot();
    }
  }) satisfies typeof fetch;
}
