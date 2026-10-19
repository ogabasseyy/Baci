/** Bounded sampling memory and cleanup work, even during rejection floods. */
export function createRejectionSampler(windowMs: number, capacity = 20_000) {
  const entries = new Map<string, number>();
  let sweep: MapIterator<[string, number]> | null = null;
  return (id: string, now = Date.now()): boolean => {
    sweep ??= entries.entries();
    for (let i = 0; i < 100; i++) {
      const next = sweep.next();
      if (next.done) {
        sweep = null;
        break;
      }
      if (next.value[1] <= now) entries.delete(next.value[0]);
    }
    const reset = entries.get(id);
    if (reset !== undefined && reset > now) return false;
    if (!entries.has(id) && entries.size >= capacity) return false;
    entries.set(id, now + windowMs);
    return true;
  };
}
