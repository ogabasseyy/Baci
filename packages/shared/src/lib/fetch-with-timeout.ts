import { withDeadline } from './with-timeout';

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
export const DEFAULT_FETCH_TIMEOUT_MESSAGE =
  'Request timed out. Please try again.';

export interface FetchWithTimeoutOptions extends RequestInit {
  /**
   * Absolute wall-clock deadline (Date.now() ms). When present, the
   * abort timer uses the REMAINING budget instead of timeoutMs, so
   * headers + body can share one per-request deadline (Codex R70
   * 6ryArL): pass the same deadlineMs here and to withDeadline for
   * the body read. Takes precedence over timeoutMs.
   */
  deadlineMs?: number;
  timeoutMessage?: string;
  timeoutMs?: number;
}

export function isAbortError(error: unknown) {
  // Abort detection cannot rely on the AbortError name alone: React
  // Native's iOS networking reports an aborted request as a plain
  // Error with "Fetch request has been canceled" (Codex R105 P2).
  // The callers gate on their own timer having fired, so a stray
  // message match outside a deadline abort cannot misclassify.
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      /\baborted\b|\bcancell?ed\b/i.test(error.message))
  );
}

function composeAbortSignals(signals: AbortSignal[]): AbortSignal | undefined {
  const activeSignals = signals.filter(Boolean);
  if (activeSignals.length === 0) {
    return undefined;
  }
  if (activeSignals.length === 1) {
    return activeSignals[0];
  }

  const controller = new AbortController();
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: FetchWithTimeoutOptions = {}
) {
  const {
    deadlineMs,
    signal,
    timeoutMessage = DEFAULT_FETCH_TIMEOUT_MESSAGE,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    ...fetchOptions
  } = options;
  const controller = new AbortController();
  const signals = signal ? [controller.signal, signal] : [controller.signal];
  let timedOut = false;
  const effectiveTimeoutMs =
    deadlineMs === undefined ? timeoutMs : Math.max(deadlineMs - Date.now(), 0);
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, effectiveTimeoutMs);

  try {
    return await fetch(input, {
      ...fetchOptions,
      signal: composeAbortSignals(signals),
    });
  } catch (error) {
    if (isAbortError(error) && timedOut) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export interface FetchJsonWithDeadlineOptions extends FetchWithTimeoutOptions {
  /** Absolute wall-clock deadline both phases share (required). */
  deadlineMs: number;
  /**
   * Whether to read the body once headers arrive. Error-row bodies
   * are usually unread (pass `(res) => res.ok`); the default reads
   * always (e.g. history needs `data.error` from failures).
   */
  shouldReadBody?: (response: Response) => boolean;
}

export interface FetchJsonWithDeadlineResult<T = unknown> {
  /** Parsed body (`null` when `shouldReadBody` skipped the read). */
  data: T;
  /** Response with headers/status intact (body consumed when read). */
  response: Response;
}

/**
 * Fetches headers AND reads the JSON body under one shared
 * wall-clock deadline, aborting the fetch itself when either phase
 * outlives it (Codex R70 6ryArL, R72 6rzq3y). Aborting at the fetch
 * level (not `body.cancel()`, which rejects on the locked stream
 * `response.json()` holds) releases the connection even for stalled
 * bodies, so retries cannot pile up abandoned downloads. A
 * `withDeadline` race backs the abort so the deadline is honored
 * even where a runtime fails to reject a pending read on abort.
 * Caller aborts propagate untouched; parse errors propagate as-is.
 * No AbortSignal.any/.timeout (missing below the safari 15.4 floor
 * and on Hermes — R66 6rvh_R).
 */
export async function fetchJsonWithDeadline<T = unknown>(
  input: RequestInfo | URL,
  options: FetchJsonWithDeadlineOptions
): Promise<FetchJsonWithDeadlineResult<T>> {
  const {
    deadlineMs,
    shouldReadBody = () => true,
    signal: callerSignal,
    timeoutMessage = DEFAULT_FETCH_TIMEOUT_MESSAGE,
    ...fetchOptions
  } = options;
  // Per-attempt owned controller: aborting it kills in-flight
  // headers AND any locked body read (the R72 mechanism).
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(deadlineMs - Date.now(), 0)
  );
  try {
    const response = await fetch(input, {
      ...fetchOptions,
      signal: composeAbortSignals(
        callerSignal ? [controller.signal, callerSignal] : [controller.signal]
      ),
    });
    if (!shouldReadBody(response)) {
      // Skipped bodies must not linger across retries (R73 6r0cZh):
      // the stream is still unlocked here, but fetch-level abort
      // releases it uniformly (a no-op once fully arrived). Headers
      // were already received, so ok/status stay readable.
      controller.abort();
      return { data: null as T, response };
    }
    const data = (await withDeadline(
      response.json(),
      deadlineMs,
      timeoutMessage
    )) as T;
    return { data, response };
  } catch (error) {
    if (isAbortError(error) && timedOut) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
