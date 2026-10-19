// In-process per-token mutex: concurrent updates to one cart from this
// process serialize instead of churning the version gate. Cross-process
// races resolve through the gate plus the caller's retry loop.
const queues = new Map<string, Promise<unknown>>();

export async function runExclusive<T>(
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  queues.set(key, pending);
  try {
    return await pending;
  } finally {
    if (queues.get(key) === pending) queues.delete(key);
  }
}
