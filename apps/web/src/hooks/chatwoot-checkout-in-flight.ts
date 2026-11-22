const inFlight = new Map<string, Promise<void>>();

/**
 * Runs `task` after any earlier task for the same key has settled, so two
 * widget messages carrying the same checkout request never place the order or
 * set up payment at the same time. The later one runs once the first is done
 * and then finds the first one's result already remembered.
 */
export function runChatwootCheckoutSerially(
  key: string,
  task: () => Promise<void>
): Promise<void> {
  const previous = inFlight.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  inFlight.set(key, next);
  const release = () => {
    if (inFlight.get(key) === next) inFlight.delete(key);
  };
  next.then(release, release);
  return next;
}
