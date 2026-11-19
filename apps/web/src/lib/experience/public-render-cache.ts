/** Public HTML fragments only. Authority and bootstrap freshness are checked by every caller. */
export function createPublicRenderCache(
  limits: { maxEntries?: number; maxBytes?: number } = {}
) {
  const maxEntries = limits.maxEntries ?? 64;
  const maxBytes = limits.maxBytes ?? 16 * 1024 * 1024;
  const entries = new Map<string, { html: string; bytes: number }>();
  const pending = new Map<string, Promise<string>>();
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
    read(key: string, render: () => Promise<string>): Promise<string> {
      const existing = entries.get(key);
      if (existing) {
        entries.delete(key);
        entries.set(key, existing);
        return Promise.resolve(existing.html);
      }
      const inflight = pending.get(key);
      if (inflight) return inflight;
      if (pending.size >= 8) return Promise.reject(Error('QUOTA_EXCEEDED'));
      const epoch = generation;
      const result = (async () => {
        const html = await render();
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
      pending.set(key, result);
      const cleanup = () => {
        if (pending.get(key) === result) pending.delete(key);
      };
      void result.then(cleanup, cleanup);
      return result;
    },
  };
}
