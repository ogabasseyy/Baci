/** Fixed-cardinality signal for observing which limiter backend served a check. */
export type RateLimitDiagnostic = {
  backend: 'redis' | 'memory';
  reason: 'redis_success' | 'redis_unavailable' | 'redis_error';
};

type RateLimitDiagnosticHook = (
  diagnostic: RateLimitDiagnostic
) => unknown | Promise<unknown>;
type RateLimitDiagnosticAsyncHook = (
  diagnostic: RateLimitDiagnostic
) => Promise<void>;
type RateLimitDiagnosticSyncHook = (diagnostic: RateLimitDiagnostic) => void;

type RateLimitDiagnosticState = {
  hook?: RateLimitDiagnosticHook;
};

// Next can compile the proxy and instrumentation entrypoints into separate
// bundles. Keep the hook in a process-global registry so those copies observe
// the same diagnostic sink instead of each retaining an isolated module local.
const RATE_LIMIT_DIAGNOSTIC_STATE_KEY =
  '__baci_rate_limit_diagnostic_state__' as const;

function getRateLimitDiagnosticState(): RateLimitDiagnosticState {
  const globalState = globalThis as typeof globalThis & {
    [RATE_LIMIT_DIAGNOSTIC_STATE_KEY]?: RateLimitDiagnosticState;
  };

  const existingState = globalState[RATE_LIMIT_DIAGNOSTIC_STATE_KEY];
  if (existingState) {
    return existingState;
  }

  const nextState: RateLimitDiagnosticState = {};
  globalState[RATE_LIMIT_DIAGNOSTIC_STATE_KEY] = nextState;
  return nextState;
}

/**
 * Installs an optional backend diagnostic sink. The sink receives no request
 * identifiers, route names, or provider details, and failures are ignored so
 * observability can never affect rate-limit decisions.
 */
function setRateLimitDiagnosticHook(
  hook: RateLimitDiagnosticAsyncHook | undefined
): void;
function setRateLimitDiagnosticHook(
  hook: RateLimitDiagnosticSyncHook | undefined
): void;
function setRateLimitDiagnosticHook(
  hook: RateLimitDiagnosticHook | undefined
): void {
  getRateLimitDiagnosticState().hook = hook;
}

function reportRateLimitDiagnostic(
  diagnostic: RateLimitDiagnostic
): Promise<void> {
  try {
    return Promise.resolve(getRateLimitDiagnosticState().hook?.(diagnostic))
      .then(() => undefined)
      .catch(() => {
        // Diagnostics are best-effort and must never change request behavior.
      });
  } catch {
    // Diagnostics are best-effort and must never change request behavior.
    return Promise.resolve();
  }
}

function resetRateLimitDiagnosticHook(): void {
  getRateLimitDiagnosticState().hook = undefined;
}

export const rateLimitDiagnostics = {
  report: reportRateLimitDiagnostic,
  reset: resetRateLimitDiagnosticHook,
  setHook: setRateLimitDiagnosticHook,
};
