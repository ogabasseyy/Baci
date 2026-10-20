/** Drain authority-creating requests before retiring the cookie they can install. */
const flights = new Map<Promise<unknown>, string>();
const retirements = new Map<string, number>();
const overlaps = (a: string, b: string) => !a || !b || a === b;

export function isCartSessionRetiring(slug?: string | null): boolean {
  return [...retirements.keys()].some((key) => overlaps(key, slug ?? ''));
}

export function runCartSessionWrite<T>(
  slug: string | null | undefined,
  blocked: T,
  operation: () => Promise<T>
): Promise<T> {
  if (isCartSessionRetiring(slug)) return Promise.resolve(blocked);
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const pending = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  }).finally(() => flights.delete(pending));
  flights.set(pending, slug ?? '');
  try {
    resolve(operation());
  } catch (error) {
    reject(error);
  }
  return pending;
}

export function beginCartSessionRetirement(slug: string) {
  retirements.set(slug, (retirements.get(slug) ?? 0) + 1);
  const drained = Promise.allSettled(
    [...flights]
      .filter(([, key]) => overlaps(key, slug))
      .map(([pending]) => pending)
  ).then(() => undefined);
  let released = false;
  return {
    drained,
    release() {
      if (released) return;
      released = true;
      const count = (retirements.get(slug) ?? 1) - 1;
      if (count) retirements.set(slug, count);
      else retirements.delete(slug);
    },
  };
}
