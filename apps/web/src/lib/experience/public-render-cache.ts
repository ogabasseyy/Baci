type RenderOutcome = { html: string } | { error: unknown };
type RenderWaiter = (outcome: RenderOutcome) => void;

interface PendingPublicRender {
  controller: AbortController;
  waiters: Set<RenderWaiter>;
}

function waitForRender(
  render: PendingPublicRender,
  signal?: AbortSignal
): Promise<string> {
  if (render.controller.signal.aborted)
    return Promise.reject(render.controller.signal.reason);
  return new Promise((resolve, reject) => {
    const settle: RenderWaiter = (outcome) => {
      render.waiters.delete(settle);
      signal?.removeEventListener('abort', abort);
      if ('html' in outcome) resolve(outcome.html);
      else reject(outcome.error);
    };
    const abort = () => {
      settle({ error: signal?.reason });
      if (render.waiters.size === 0) render.controller.abort(signal?.reason);
    };
    render.waiters.add(settle);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** Public HTML fragments only. Authority and bootstrap freshness are checked by every caller. */
export function createPublicRenderCache(
  limits: { maxEntries?: number; maxBytes?: number } = {}
) {
  const maxEntries = limits.maxEntries ?? 64;
  const maxBytes = limits.maxBytes ?? 16 * 1024 * 1024;
  const entries = new Map<string, { html: string; bytes: number }>();
  const pending = new Map<string, PendingPublicRender>();
  let bytes = 0;
  let generation = 0;
  if (
    !Number.isInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > 64 ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 16 * 1024 * 1024
  )
    throw Error('INVALID_REQUEST');
  return {
    clear() {
      generation++;
      entries.clear();
      pending.clear();
      bytes = 0;
    },
    read(
      key: string,
      render: (signal: AbortSignal) => Promise<string>,
      signal?: AbortSignal
    ): Promise<string> {
      if (signal?.aborted) return Promise.reject(signal.reason);
      const existing = entries.get(key);
      if (existing) {
        entries.delete(key);
        entries.set(key, existing);
        return Promise.resolve(existing.html);
      }
      const inflight = pending.get(key);
      if (inflight) return waitForRender(inflight, signal);
      if (pending.size >= 8) return Promise.reject(Error('QUOTA_EXCEEDED'));
      const epoch = generation;
      const controller = new AbortController();
      const result = (async () => {
        const html = await render(controller.signal);
        controller.signal.throwIfAborted();
        const size = Buffer.byteLength(html);
        if (size > maxBytes || size > 1024 * 1024)
          throw Error('QUOTA_EXCEEDED');
        if (generation === epoch) {
          while (entries.size >= maxEntries || bytes + size > maxBytes) {
            const first = entries.entries().next().value;
            if (!first) break;
            entries.delete(first[0]);
            bytes -= first[1].bytes;
          }
          entries.set(key, { html, bytes: size });
          bytes += size;
        }
        return html;
      })();
      const inflightRender = { controller, waiters: new Set<RenderWaiter>() };
      pending.set(key, inflightRender);
      const finish = (outcome: RenderOutcome) => {
        if (pending.get(key) === inflightRender) pending.delete(key);
        for (const settle of inflightRender.waiters) settle(outcome);
      };
      void result.then(
        (html) => finish({ html }),
        (error) => finish({ error })
      );
      return waitForRender(inflightRender, signal);
    },
  };
}
