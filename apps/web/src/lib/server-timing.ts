/**
 * Per-step durations for one request, exposed as a response header so
 * latency can be read from any browser against the live site. Durations
 * only: step names are fixed tokens chosen by the caller, and no request,
 * shopper or merchant data is ever included.
 */
export interface ServerTimer {
  /** Runs one step and records how long it took, even when it throws. */
  measure<T>(name: string, step: () => PromiseLike<T> | T): Promise<T>;
  /**
   * Adds the recorded steps, plus the total so far, to the response,
   * keeping any timing entries already on it. Never throws: a response
   * whose headers cannot be changed is returned as it is.
   */
  apply<R extends Response>(response: R): R;
}

export interface ServerTimerOptions {
  /** Response header that carries the entries. */
  header?: string;
  now?: () => number;
}

const STEP_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const TOTAL_STEP = 'total';

export function createServerTimer({
  header = 'Server-Timing',
  now = () => performance.now(),
}: ServerTimerOptions = {}): ServerTimer {
  const started = now();
  const steps: Array<{ name: string; duration: number }> = [];
  return {
    async measure(name, step) {
      // `total` is reserved for the entry apply() adds itself.
      if (!STEP_NAME.test(name) || name === TOTAL_STEP) {
        throw new Error('Invalid timing step name');
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
      try {
        // Append: the framework or a proxy may already report its own steps.
        response.headers.append(header, entries.join(', '));
      } catch {
        // Immutable headers (for example a fetched response): timing is
        // diagnostic and must never fail the request.
      }
      return response;
    },
  };
}
