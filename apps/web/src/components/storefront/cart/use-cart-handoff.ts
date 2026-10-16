'use client';
import type { CartSnapshot } from '@baci/shared/cart';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { postHandoffRedeem } from './cart-handoff-redeem';
import {
  type Choice,
  clearAttemptBody,
  clearHandoffAttempt,
  fetchJson,
  loadAttemptBody,
  loadOrCreateAttemptId,
  lockedAttemptChoice,
  type MergeConflictView,
  mergeResolutionList,
  type PreviewResponse,
  planHandoffMerge as planMerge,
  recordAttemptBody,
  recordAttemptChoice,
  recordResolutionList,
  redactHandoffFragment,
} from './cart-handoff-support';
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
  const [lockedChoice, setLockedChoice] = useState<Choice | null>(null);
  const [sentBody, setSentBody] = useState<Record<string, unknown> | null>(
    null
  );
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const bootstrapRequired = useRef(false);
  useLayoutEffect(() => {
    redactHandoffFragment();
  }, []);

  const loadStarted = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: this effect loads once; refresh is intentionally user-triggered thereafter.
  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;
    setLockedChoice(lockedAttemptChoice(handoffId));
    setSentBody(loadAttemptBody(handoffId));
    void loadPreview();
  }, []);

  async function loadDestination(slug: string | null): Promise<void> {
    setDestChecked(false);
    setDestinationError(null);
    const url = slug
      ? `/api/storefront/cart?merchantSlug=${encodeURIComponent(slug)}`
      : '/api/storefront/cart';
    try {
      const response = await fetchJson(url);
      const payload = (await response.json()) as {
        cart?: CartSnapshot;
        code?: string;
      };
      if (!response.ok) {
        if (
          response.status === 401 &&
          ['missing_proof', 'expired_proof', 'invalid_proof'].includes(
            payload.code ?? ''
          )
        ) {
          bootstrapRequired.current = true;
        } else if (
          response.status !== 404 ||
          !['not_found', 'expired'].includes(payload.code ?? '')
        ) {
          setDestinationError(
            'Could not check your existing cart. Please try again.'
          );
          return;
        }
        setDestCart(null);
      } else {
        bootstrapRequired.current = false;
        setDestCart(payload.cart ?? null);
      }
      setDestChecked(true);
    } catch {
      setDestinationError(
        'Could not check your existing cart. Please try again.'
      );
    }
  }

  async function loadPreview(): Promise<PreviewResponse | null> {
    setLoadError(null);
    setPreviewRetryable(false);
    try {
      const response = await fetchJson(
        `/api/storefront/cart/handoff?handoff_id=${encodeURIComponent(handoffId)}`,
        { headers: { 'x-handoff-token': token } }
      );
      const payload = (await response.json()) as PreviewResponse;
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) {
          setPreviewRetryable(true);
          setLoadError('Could not load this cart link. Please try again.');
          return null;
        }
        setLoadError(
          'This link is no longer valid. Ask the sender for a fresh one.'
        );
        return null;
      }
      setPreview(payload);
      if (payload.status === 'pending') {
        await loadDestination(payload.merchant?.slug ?? null);
      } else {
        setDestChecked(true);
      }
      return payload;
    } catch {
      setPreviewRetryable(true);
      setLoadError('Could not load this cart link. Check your connection.');
      return null;
    }
  }

  function lockChoice(choice: Choice): void {
    recordAttemptChoice(handoffId, choice);
    setLockedChoice(choice);
  }

  function postRedeem(body: Record<string, unknown>): Promise<boolean> {
    // Persist the exact body before sending: retries of an unresolved
    // attempt resend it verbatim instead of replanning from the
    // shopper's possibly edited selections.
    recordAttemptBody(handoffId, body);
    setSentBody(body);
    return postHandoffRedeem(
      {
        handoffId,
        merchantSlug: preview?.merchant?.slug,
        bootstrapRequired,
        setRedeeming,
        setRedeemError,
        setConflicts,
        setResolutions,
        setLoadError,
        onAttemptConsumed: () => {
          clearHandoffAttempt(handoffId);
          setLockedChoice(null);
          setSentBody(null);
        },
        onMergeConflict: () => {
          clearAttemptBody(handoffId);
          setSentBody(null);
        },
        refreshPreview: loadPreview,
      },
      body
    );
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
    attemptSent: sentBody !== null,
    redeemError,
    destinationError,
    setDestinationError,
    loadPreview,
    act,
    continueMerge,
  };
}
