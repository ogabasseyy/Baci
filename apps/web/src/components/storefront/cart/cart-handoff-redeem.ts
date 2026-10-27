import { withCartRequestDeadline } from '@/hooks/cart/cart-request-deadline';
import { runCartSessionTransition } from '@/hooks/cart/cart-session-write-fence';
import { cartClientCredentialHeaders } from '@/hooks/cart/client-credential';
import { isCartDeviceRevocationPending } from '@/hooks/cart/shared-cart-session-revoke-client';
import { fetchWithCsrf } from '@/lib/api-client';
import type { MergeConflictView } from './cart-handoff-support';

/** Bound the post-outcome preview refresh so a stalled refresh cannot strand the redeeming state; the deadline signal cancels the refresh so it cannot mutate state after a retry starts. */
function refreshPreviewBounded(deps: HandoffRedeemDeps): Promise<unknown> {
  return withCartRequestDeadline(null, async (signal) => {
    await deps.refreshPreview(signal);
    return null;
  });
}

export interface HandoffRedeemDeps {
  handoffId: string;
  merchantSlug: string | null | undefined;
  bootstrapRequired: { current: boolean };
  setRedeeming(value: boolean): void;
  setRedeemError(value: string | null): void;
  setConflicts(value: MergeConflictView[]): void;
  setResolutions(value: Record<string, 'incoming' | 'existing'>): void;
  setLoadError(value: string | null): void;
  /** Attempt and its locked choice are consumed: clear both stores. */
  onAttemptConsumed(): void;
  /** Terminal outcome: also clear the tab-scoped handoff locator. */
  onTerminalOutcome(): void;
  /** Definitive merge conflict: release the sent body for fresh picks. */
  onMergeConflict(): void;
  refreshPreview(signal?: AbortSignal): Promise<unknown>;
}

/**
 * One redemption POST plus its outcome handling. Definitive outcomes
 * (success, consumed, expired, version conflict) release the attempt
 * and its locked choice; indeterminate outcomes keep them so the same
 * attempt can be retried and its result checked.
 */
export async function postHandoffRedeem(
  deps: HandoffRedeemDeps,
  body: Record<string, unknown>
): Promise<boolean> {
  deps.setRedeeming(true);
  deps.setRedeemError(null);
  try {
    const result = await withCartRequestDeadline(null, (signal) =>
      runCartSessionTransition<Awaited<ReturnType<typeof requestHandoff>>>(
        deps.merchantSlug,
        null,
        () =>
          withCartRequestDeadline(
            null,
            (requestSignal) => requestHandoff(deps, body, requestSignal),
            signal
          ),
        { isSuccessful: (reply) => reply?.response.ok === true, signal }
      )
    );
    if (!result) {
      deps.setRedeemError(
        'Could not continue this cart. Check your connection.'
      );
      return false;
    }
    const { response, payload } = result;
    if (payload.code === 'bootstrap_failed') {
      deps.setRedeemError(
        'Could not connect your cart session. Please try again.'
      );
      return false;
    }
    if (response.ok) {
      deps.onAttemptConsumed();
      deps.onTerminalOutcome();
      window.location.replace(
        window.location.pathname + window.location.search
      );
      return true;
    }
    if (response.status === 409 && payload.code === 'merge_conflict') {
      deps.onMergeConflict();
      deps.setConflicts(payload.conflicts ?? []);
      deps.setResolutions({});
      return false;
    }
    if (
      payload.code === 'missing_proof' ||
      payload.code === 'expired_proof' ||
      payload.code === 'invalid_proof'
    ) {
      // The destination session proof died before the redemption RPC
      // ran, so nothing was sent under this attempt: release it, mark
      // bootstrap as required, and reload so a fresh proof is minted.
      deps.onAttemptConsumed();
      deps.bootstrapRequired.current = true;
      deps.setRedeemError(
        'Your cart session expired. Review your cart and try again.'
      );
      await refreshPreviewBounded(deps);
      return false;
    }
    if (response.status === 409 && payload.code === 'version_conflict') {
      // The redemption was definitively rejected before any receipt
      // was stored, so the attempt and its choice are released: the
      // shopper reviews the refreshed carts and may choose again.
      deps.onAttemptConsumed();
      deps.setRedeemError(
        'One of the carts changed. Review the latest state and try again.'
      );
      // Offer picks belong to the carts that were just superseded:
      // clear them so the shopper reviews the refreshed offers
      // instead of applying a stale incoming/existing choice.
      deps.setConflicts([]);
      deps.setResolutions({});
      await refreshPreviewBounded(deps);
      return false;
    }
    if (payload.code === 'handoff_consumed') {
      deps.onAttemptConsumed();
      deps.onTerminalOutcome();
      deps.setLoadError(
        'This link was already used. Ask the sender for a fresh one.'
      );
      return false;
    }
    if (payload.code === 'expired') {
      deps.onAttemptConsumed();
      deps.onTerminalOutcome();
      deps.setLoadError(
        'This link has expired. Ask the sender for a fresh one.'
      );
      return false;
    }
    deps.setRedeemError('Could not continue this cart. Please try again.');
    return false;
  } catch {
    deps.setRedeemError('Could not continue this cart. Check your connection.');
    return false;
  } finally {
    deps.setRedeeming(false);
  }
}

/** Only network/cookie work holds the lock; recovery callbacks run after release. */
async function requestHandoff(
  deps: HandoffRedeemDeps,
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<{
  response: Response;
  payload: { code?: string; conflicts?: MergeConflictView[] };
} | null> {
  const slug = deps.merchantSlug;
  if (isCartDeviceRevocationPending(slug)) return null;
  if (deps.bootstrapRequired.current) {
    const bootstrap = await fetchWithCsrf('/api/storefront/cart/bootstrap', {
      body: JSON.stringify(slug ? { merchantSlug: slug } : {}),
      headers: {
        'Content-Type': 'application/json',
        ...cartClientCredentialHeaders(),
      },
      method: 'POST',
      referrerPolicy: 'no-referrer',
      signal,
    });
    if (signal.aborted) return null;
    if (!bootstrap.ok)
      return { response: bootstrap, payload: { code: 'bootstrap_failed' } };
    // Keep this retry identity after an indeterminate redeem response.
    deps.bootstrapRequired.current = false;
  }
  const url = slug
    ? `/api/storefront/cart/handoff/redeem?merchantSlug=${encodeURIComponent(slug)}`
    : '/api/storefront/cart/handoff/redeem';
  const response = await fetchWithCsrf(url, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    referrerPolicy: 'no-referrer',
    signal,
  });
  const payload = (await response.json()) as {
    code?: string;
    conflicts?: MergeConflictView[];
  };
  if (signal.aborted) return null;
  return { response, payload };
}
