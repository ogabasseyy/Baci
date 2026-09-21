export function createSerialAsyncQueue() {
  let tail: Promise<unknown> = Promise.resolve();

  return function enqueueSerialAsync<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    const run = tail.then(operation, operation);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

export function createKeyedSerialAsyncQueue() {
  const tails = new Map<string, Promise<unknown>>();

  return function enqueueKeyedSerialAsync<T>(
    key: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    tails.set(key, settled);
    // Prune idle keys so generations do not accumulate; only the latest tail
    // removes itself, so a newer enqueue is never dropped by an older one.
    void settled.then(() => {
      if (tails.get(key) === settled) {
        tails.delete(key);
      }
    });
    return run;
  };
}
