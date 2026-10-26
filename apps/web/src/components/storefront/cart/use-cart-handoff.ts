'use client';
import type { CartSnapshot } from '@baci/shared/cart';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchDestinationCart } from './cart-handoff-destination';
import {
  type Choice,
  clearActiveHandoff,
  clearHandoffAttempt,
  fetchJson,
  loadActiveHandoff,
  loadAttemptBody,
  loadOrCreateAttemptId,
  lockedAttemptChoice,
  type MergeConflictView,
  mergeResolutionList,
  type PreviewResponse,
  planHandoffMerge as planMerge,
  recordActiveHandoff,
  recordResolutionList,
  redactHandoffFragment,
} from './cart-handoff-support';
import { useHandoffRedeem } from './use-handoff-redeem';
export function useCartHandoff(props: { token: string; handoffId: string }) {
  const { token, handoffId } = props;
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [destCart, setDestCart] = useState<CartSnapshot | null>(null);
  const [destChecked, setDestChecked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewRetryable, setPreviewRetryable] = useState(false);
  const [conflicts, setConflicts] = useState<MergeConflictView[]>([]);
  const [resolutions, setResolutions] = useState<
    Record<string, 'incoming' | 'existing'>
  >({});
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const bootstrapRequired = useRef(false);
  const redeem = useHandoffRedeem({
    handoffId,
    merchantSlug: preview?.merchant?.slug,
    bootstrapRequired,
    setRedeeming,
    setRedeemError,
    setConflicts,
    setResolutions,
    setLoadError,
    refreshPreview: (signal) => loadPreview(signal),
  });
  const { lockedChoice, setLockedChoice, sentBody, lockChoice, postRedeem } =
    redeem;
  // biome-ignore lint/correctness/useExhaustiveDependencies: record once on mount before the fragment secret is redacted.
  useLayoutEffect(() => {
    // Preserve a tab-scoped locator before the secret leaves the URL,
    // so a reload can reconstruct this flow and replay its attempt.
    recordActiveHandoff(token, handoffId);
    redactHandoffFragment();
  }, []);

  const loadStarted = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: this effect loads once; refresh is intentionally user-triggered thereafter.
  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;
    setLockedChoice(lockedAttemptChoice(handoffId));
    redeem.restorePersistedAttempt();
    void loadPreview();
  }, []);

  async function loadDestination(
    slug: string | null,
    signal?: AbortSignal
  ): Promise<void> {
    setDestChecked(false);
    setDestinationError(null);
    const result = await fetchDestinationCart(slug, signal);
    // An aborted refresh here is the bounded deadline expiring (the
    // only signal source): surface a retryable destination error
    // instead of stranding the screen on its loading state.
    if (signal?.aborted) {
      setDestChecked(true);
      setDestinationError(
        'Could not check your existing cart. Please try again.'
      );
      return;
    }
    if (result.status === 'error') {
      setDestinationError(
        'Could not check your existing cart. Please try again.'
      );
      return;
    }
    bootstrapRequired.current = result.bootstrapRequired;
    setDestCart(result.cart);
    setDestChecked(true);
  }

  async function loadPreview(
    signal?: AbortSignal
  ): Promise<PreviewResponse | null> {
    setLoadError(null);
    setPreviewRetryable(false);
    try {
      const response = await fetchJson(
        `/api/storefront/cart/handoff?handoff_id=${encodeURIComponent(handoffId)}`,
        { headers: { 'x-handoff-token': token }, signal }
      );
      const payload = (await response.json()) as PreviewResponse;
      // A superseded refresh (deadline elapsed, retry started) must not
      // mutate preview, attempt, or locked-choice state afterwards.
      if (signal?.aborted) return null;
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) {
          setPreviewRetryable(true);
          setLoadError('Could not load this cart link. Please try again.');
          return null;
        }
        // Definitive failure: the link is dead, so drop the locator
        // and attempt state instead of restoring this screen on every
        // later cart-page load. Retryable failures keep them.
        clearHandoffAttempt(handoffId);
        clearActiveHandoff(handoffId);
        redeem.clearLockedChoice();
        setLoadError(
          'This link is no longer valid. Ask the sender for a fresh one.'
        );
        return null;
      }
      setPreview(payload);
      if (payload.merchant?.slug)
        recordActiveHandoff(token, handoffId, payload.merchant.slug);
      if (payload.status === 'pending') {
        await loadDestination(payload.merchant?.slug ?? null, signal);
      } else {
        setDestChecked(true);
        if (payload.status === 'expired') {
          // Terminal: drop the attempt and locator so later cart-page
          // loads do not restore this dead continuation.
          clearHandoffAttempt(handoffId);
          clearActiveHandoff(handoffId);
          redeem.clearLockedChoice();
        }
        if (payload.status === 'consumed') {
          // A link consumed by our own earlier attempt (whose success
          // response or replacement cookie was lost) replays its
          // receipt when the persisted body is resent; a link consumed
          // by someone else has no local body and simply ends here.
          const persistedBody = loadAttemptBody(handoffId);
          if (persistedBody) {
            // Consumed previews return merchant: null; replay under
            // the merchant scope recorded while the link was pending.
            await postRedeem(
              persistedBody,
              loadActiveHandoff()?.merchantSlug ??
                payload.merchant?.slug ??
                undefined
            );
          } else {
            // Terminal with nothing to replay: drop the locator so
            // later cart-page loads do not restore this dead handoff.
            clearActiveHandoff(handoffId);
          }
        }
      }
      return payload;
    } catch {
      if (signal?.aborted) return null;
      setPreviewRetryable(true);
      setLoadError('Could not load this cart link. Check your connection.');
      return null;
    }
  }

  async function act(choice: Choice): Promise<void> {
    if (!preview?.snapshot) return;
    // The redeem RPC replays by attempt id alone: once an attempt has
    // started, a different choice under the same id would silently
    // apply the original redemption. Lock retries to the first choice
    // until its outcome is definitive.
    const lockedChoice = lockedAttemptChoice(handoffId);
    if (lockedChoice && lockedChoice !== choice) {
      setRedeemError(
        'A previous choice for this link is still being confirmed. Retry that same choice so its outcome can be checked.'
      );
      return;
    }
    const persistedBody = sentBody ?? loadAttemptBody(handoffId);
    if (persistedBody) {
      // A previous attempt may already have committed; every retry —
      // including top-level choices after a remount — resends its
      // exact body rather than rebuilding from refreshed cart
      // versions under the old attempt id.
      await postRedeem(persistedBody);
      return;
    }
    const attemptId = loadOrCreateAttemptId(handoffId);
    const base = {
      attemptId,
      choice,
      destCartId: destCart?.cartId,
      expectedDestVersion: destCart?.version,
      expectedIncomingVersion: preview.snapshot.version,
      handoffId,
      token,
    };
    if (choice !== 'merge' || !destCart) {
      // Lock only once a redemption is actually about to be sent:
      // client-side preflight exits (capacity, conflicts) commit
      // nothing, so the shopper must stay free to choose differently.
      lockChoice(choice);
      await postRedeem(base);
      return;
    }
    const resolutionList = recordResolutionList(conflicts, resolutions);
    const planned = planMerge(destCart, preview.snapshot, resolutionList);
    if (!planned.ok && planned.code === 'too_many_lines') {
      setRedeemError(
        'These carts hold too many different items to merge. Connect instead.'
      );
      return;
    }
    if (!planned.ok) {
      setConflicts(planned.conflicts);
      return;
    }
    lockChoice(choice);
    await postRedeem({
      ...base,
      lines: planned.lines,
      resolutions: resolutionList,
    });
  }

  async function continueMerge(): Promise<void> {
    if (!preview?.snapshot || !destCart) return;
    const persistedBody = sentBody ?? loadAttemptBody(handoffId);
    if (persistedBody) {
      // An earlier merge attempt may already have committed; resend
      // its exact body so the replayed receipt matches what was sent.
      await postRedeem(persistedBody);
      return;
    }
    const resolutionList = mergeResolutionList(conflicts, resolutions);
    if (resolutionList.length !== conflicts.length) {
      setRedeemError('Choose which version to keep for every listed item.');
      return;
    }
    // Keep opaque refs; the server applies the chosen offer and quantities.
    const planned = planMerge(destCart, preview.snapshot, resolutionList);
    if (!planned.ok) {
      if (planned.code === 'merge_conflict') {
        setConflicts(planned.conflicts);
      } else {
        setRedeemError(
          'These carts hold too many different items to merge. Connect instead.'
        );
      }
      return;
    }
    const lockedMergeChoice = lockedAttemptChoice(handoffId);
    if (lockedMergeChoice && lockedMergeChoice !== 'merge') {
      setRedeemError(
        'A previous choice for this link is still being confirmed. Retry that same choice so its outcome can be checked.'
      );
      return;
    }
    lockChoice('merge');
    const attemptId = loadOrCreateAttemptId(handoffId);
    const ok = await postRedeem({
      attemptId,
      choice: 'merge',
      destCartId: destCart.cartId,
      expectedDestVersion: destCart.version,
      expectedIncomingVersion: preview.snapshot.version,
      handoffId,
      lines: planned.lines,
      resolutions: resolutionList,
      token,
    });
    if (ok) {
      setConflicts([]);
    }
  }
  return {
    preview,
    destCart,
    destChecked,
    loadError,
    previewRetryable,
    conflicts,
    setConflicts,
    resolutions,
    setResolutions,
    redeeming,
    lockedChoice,
    attemptSent: redeem.attemptSent,
    redeemError,
    destinationError,
    setDestinationError,
    loadPreview,
    act,
    continueMerge,
  };
}
