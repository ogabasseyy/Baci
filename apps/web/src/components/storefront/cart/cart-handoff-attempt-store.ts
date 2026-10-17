/**
 * Tab-scoped redemption-attempt state: the exact body sent for an
 * unresolved attempt (retries resend it verbatim — replaying by
 * attempt id applies the original receipt, so rebuilding lines or
 * resolutions after an indeterminate response could contradict what
 * the shopper now sees selected) and the tab-scoped active-handoff
 * locator. The body carries the raw single-use handoff token, so it
 * lives in sessionStorage (tab-scoped, alongside the locator that
 * already holds the pairing secret) rather than origin-wide
 * persistent localStorage.
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
    window.sessionStorage.setItem(key, JSON.stringify(body));
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
    window.sessionStorage.removeItem(attemptBodyStorageKey(handoffId));
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
    const stored = window.sessionStorage.getItem(key);
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

export function recordActiveHandoff(
  token: string,
  handoffId: string,
  merchantSlug?: string | null
): void {
  try {
    // Preserve a previously recorded merchant scope when the caller
    // does not know it yet (consumed previews return merchant: null,
    // but the replay still needs the slug to resolve the merchant).
    const existing = loadActiveHandoff();
    const slug =
      merchantSlug ??
      (existing?.handoffId === handoffId ? existing.merchantSlug : null);
    window.sessionStorage.setItem(
      ACTIVE_HANDOFF_KEY,
      JSON.stringify({ token, handoffId, merchantSlug: slug })
    );
  } catch {
    /* Storage is optional; the in-page flow continues regardless. */
  }
}

export function loadActiveHandoff(): {
  token: string;
  handoffId: string;
  merchantSlug: string | null;
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
      return {
        token: parsed.token,
        handoffId: parsed.handoffId,
        merchantSlug:
          'merchantSlug' in parsed && typeof parsed.merchantSlug === 'string'
            ? parsed.merchantSlug
            : null,
      };
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
