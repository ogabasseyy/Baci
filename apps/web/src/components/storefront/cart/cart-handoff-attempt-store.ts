/**
 * Persisted redemption-attempt state: the exact body sent for an
 * unresolved attempt (retries resend it verbatim — replaying by
 * attempt id applies the original receipt, so rebuilding lines or
 * resolutions after an indeterminate response could contradict what
 * the shopper now sees selected) and the tab-scoped active-handoff
 * locator (the pairing secret lives in the URL fragment, which the
 * continuation immediately redacts; without this record a browser
 * reload could never reconstruct the flow or replay its attempt).
 */

function attemptBodyStorageKey(handoffId: string): string {
  return `baci-cart-handoff-attempt:${handoffId}:body`;
}

const attemptBodies = new Map<string, Record<string, unknown>>();

export function recordAttemptBody(
  handoffId: string,
  body: Record<string, unknown>
): void {
  const key = attemptBodyStorageKey(handoffId);
  attemptBodies.set(key, body);
  try {
    window.localStorage.setItem(key, JSON.stringify(body));
  } catch {
    /* Use the tab cache. */
  }
}

/**
 * Release only the persisted body (a definitive merge_conflict asks
 * for fresh picks); the attempt id and locked choice stay so the
 * retry keeps its identity.
 */
export function clearAttemptBody(handoffId: string): void {
  attemptBodies.delete(attemptBodyStorageKey(handoffId));
  try {
    window.localStorage.removeItem(attemptBodyStorageKey(handoffId));
  } catch {
    /* Storage may be disabled. */
  }
}

export function loadAttemptBody(
  handoffId: string
): Record<string, unknown> | null {
  const key = attemptBodyStorageKey(handoffId);
  const cached = attemptBodies.get(key);
  if (cached) return cached;
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const body = parsed as Record<string, unknown>;
      attemptBodies.set(key, body);
      return body;
    }
  } catch {
    /* Storage is optional; the tab cache still holds the body. */
  }
  return null;
}

const ACTIVE_HANDOFF_KEY = 'baci-cart-handoff-active';

export function recordActiveHandoff(token: string, handoffId: string): void {
  try {
    window.sessionStorage.setItem(
      ACTIVE_HANDOFF_KEY,
      JSON.stringify({ token, handoffId })
    );
  } catch {
    /* Storage is optional; the in-page flow continues regardless. */
  }
}

export function loadActiveHandoff(): {
  token: string;
  handoffId: string;
} | null {
  try {
    const stored = window.sessionStorage.getItem(ACTIVE_HANDOFF_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'token' in parsed &&
      'handoffId' in parsed &&
      typeof parsed.token === 'string' &&
      typeof parsed.handoffId === 'string' &&
      parsed.token &&
      parsed.handoffId
    ) {
      return { token: parsed.token, handoffId: parsed.handoffId };
    }
  } catch {
    /* Storage is optional. */
  }
  return null;
}

export function clearActiveHandoff(handoffId: string): void {
  try {
    if (loadActiveHandoff()?.handoffId === handoffId)
      window.sessionStorage.removeItem(ACTIVE_HANDOFF_KEY);
  } catch {
    /* Storage may be disabled. */
  }
}
