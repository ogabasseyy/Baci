export function createKeyedSerialAsyncQueue() {
  const tails = new Map<string, Promise<unknown>>();

  function enqueueKeyedSerialAsync<T>(
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
  }

  function resetKeyedSerialAsyncQueueKey(key: string): void {
    // Detach only this key's tail: other keys keep their order while the
    // reset key starts a fresh chain. The abandoned tail still drains on
    // its own, and its prune skips itself since the tail no longer matches.
    tails.delete(key);
  }

  return Object.assign(enqueueKeyedSerialAsync, {
    resetKey: resetKeyedSerialAsyncQueueKey,
  });
}
