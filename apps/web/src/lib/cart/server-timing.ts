/**
 * Per-step durations for a cart request, exposed as a `Server-Timing`
 * response header so latency can be read from any browser against the live
 * store. Durations only: step names are fixed tokens chosen by the route,
 * and no request, cart, shopper or merchant data is ever included.
 */
export interface CartServerTimer {
  /** Runs one step and records how long it took, even when it throws. */
  measure<T>(name: string, step: () => PromiseLike<T> | T): Promise<T>;
  /**
   * Adds the recorded steps, plus the total so far, to the response,
   * keeping any timing entries already on it.
   */
  apply<R extends Response>(response: R): R;
}

const STEP_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const TOTAL_STEP = 'total';

export function createCartServerTimer(
  now: () => number = () => performance.now()
): CartServerTimer {
  const started = now();
  const steps: Array<{ name: string; duration: number }> = [];
  return {
    async measure(name, step) {
      // `total` is reserved for the entry apply() adds itself.
      if (!STEP_NAME.test(name) || name === TOTAL_STEP) {
        throw new Error('Invalid cart timing step name');
      }
      const stepStarted = now();
      try {
        return await step();
      } finally {
        steps.push({ name, duration: now() - stepStarted });
      }
    },
    apply(response) {
      const entries = [
        ...steps,
        { name: TOTAL_STEP, duration: now() - started },
      ].map(
        ({ name, duration }) =>
          `${name};dur=${Math.max(0, duration).toFixed(1)}`
      );
      // Append: the framework or a proxy may already report its own steps.
      response.headers.append('Server-Timing', entries.join(', '));
      return response;
    },
  };
}
