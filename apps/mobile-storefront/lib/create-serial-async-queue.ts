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
