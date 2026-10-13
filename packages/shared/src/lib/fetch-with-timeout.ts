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
  return error instanceof Error && error.name === 'AbortError';
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

/**
 * Reads a response body as JSON under one shared wall-clock
 * deadline. Combines `withDeadline` with stalled-stream cleanup
 * (Codex R71 6rzIQ3): when the body outlives the deadline, the
 * wrapper rejects AND the abandoned stream is cancelled, so retries
 * cannot pile up connections behind stalled bodies. Parse errors
 * propagate unchanged; cleanup never throws (a missing/unusable
 * `body`, e.g. non-browser runtimes, degrades to a no-op).
 */
export async function readJsonWithDeadline<T = unknown>(
  response: Response,
  deadlineMs: number
): Promise<T> {
  const body = response.body;
  try {
    return (await withDeadline(response.json(), deadlineMs)) as T;
  } catch (error) {
    try {
      await body?.cancel();
    } catch {
      // Best-effort cleanup: the attempt already failed.
    }
    throw error;
  }
}
