'use client';
import type { CartItemIdentity, CartSnapshot } from '@baci/shared/cart';
import { cartLineIdentity } from '@baci/shared/cart';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { planCartMerge } from '@/lib/cart/merge';
import { buildCsrfHeaders } from '@/lib/csrf';
import {
  attemptStorageKey,
  type Choice,
  fetchJson,
  loadOrCreateAttemptId,
  type MergeConflictView,
  type PreviewResponse,
} from './cart-handoff-support';
export function useCartHandoff(props: { token: string; handoffId: string }) {
  const { token, handoffId } = props;
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [destCart, setDestCart] = useState<CartSnapshot | null>(null);
  const [destChecked, setDestChecked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<MergeConflictView[]>([]);
  const [resolutions, setResolutions] = useState<
    Record<string, 'incoming' | 'existing'>
  >({});
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const bootstrapRequired = useRef(false);
  // Strip the pairing fragment before anything else runs: fragments never
  // reach the server, and removing it keeps the secret out of history,
  // session replays and any third-party script that reads the URL.
  useLayoutEffect(() => {
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search
    );
  }, []);

  const loadStarted = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: this effect loads once; refresh is intentionally user-triggered thereafter.
  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;
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
        if (payload.code === 'missing_proof' && response.status === 401) {
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
    try {
      const response = await fetchJson(
        `/api/storefront/cart/handoff?handoff_id=${encodeURIComponent(handoffId)}`
      );
      const payload = (await response.json()) as PreviewResponse;
      if (!response.ok) {
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
      setLoadError('Could not load this cart link. Check your connection.');
      return null;
    }
  }

  async function postRedeem(body: Record<string, unknown>): Promise<boolean> {
    setRedeeming(true);
    setRedeemError(null);
    try {
      const slug = preview?.merchant?.slug;
      if (bootstrapRequired.current) {
        const bootstrap = await fetchJson('/api/storefront/cart/bootstrap', {
          body: JSON.stringify(slug ? { merchantSlug: slug } : {}),
          headers: {
            'Content-Type': 'application/json',
            ...buildCsrfHeaders(),
          },
          method: 'POST',
        });
        if (!bootstrap.ok) {
          setRedeemError(
            'Could not connect your cart session. Please try again.'
          );
          return false;
        }
        // Keep this retry identity after an indeterminate redeem response.
        bootstrapRequired.current = false;
      }
      const url = slug
        ? `/api/storefront/cart/handoff/redeem?merchantSlug=${encodeURIComponent(slug)}`
        : '/api/storefront/cart/handoff/redeem';
      const response = await fetchJson(url, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', ...buildCsrfHeaders() },
        method: 'POST',
      });
      const payload = (await response.json()) as {
        code?: string;
        conflicts?: MergeConflictView[];
      };
      if (response.ok) {
        window.localStorage.removeItem(attemptStorageKey(handoffId));
        window.location.replace(
          window.location.pathname + window.location.search
        );
        return true;
      }
      if (response.status === 409 && payload.code === 'merge_conflict') {
        setConflicts(payload.conflicts ?? []);
        setResolutions({});
        return false;
      }
      if (response.status === 409 && payload.code === 'version_conflict') {
        setRedeemError(
          'One of the carts changed. Review the latest state and try again.'
        );
        await loadPreview();
        return false;
      }
      if (payload.code === 'handoff_consumed') {
        setLoadError(
          'This link was already used. Ask the sender for a fresh one.'
        );
        return false;
      }
      if (payload.code === 'expired') {
        setLoadError('This link has expired. Ask the sender for a fresh one.');
        return false;
      }
      setRedeemError('Could not continue this cart. Please try again.');
      return false;
    } catch {
      setRedeemError('Could not continue this cart. Check your connection.');
      return false;
    } finally {
      setRedeeming(false);
    }
  }

  async function act(choice: Choice): Promise<void> {
    if (!preview?.snapshot) return;
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
      await postRedeem(base);
      return;
    }
    const resolutionList = Object.entries(resolutions).map(([key, keep]) => ({
      item: conflictItemForKey(key) ?? { productId: key },
      keep,
    }));
    const planned = planCartMerge(destCart, preview.snapshot, resolutionList);
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
    await postRedeem({
      ...base,
      lines: planned.lines,
      resolutions: resolutionList,
    });
  }

  function conflictItemForKey(key: string): CartItemIdentity | null {
    return (
      conflicts.find((conflict) => cartLineIdentity(conflict.item) === key)
        ?.item ?? null
    );
  }

  async function continueMerge(): Promise<void> {
    if (!preview?.snapshot || !destCart) return;
    const resolutionList = conflicts
      .filter((conflict) => resolutions[cartLineIdentity(conflict.item)])
      .map((conflict) => ({
        item: conflict.item,
        keep: resolutions[cartLineIdentity(conflict.item)] as
          | 'incoming'
          | 'existing',
      }));
    if (resolutionList.length !== conflicts.length) {
      setRedeemError('Choose which version to keep for every listed item.');
      return;
    }
    // Re-plan locally so quantities follow max; the server re-enforces.
    const planned = planCartMerge(destCart, preview.snapshot, resolutionList);
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
    conflicts,
    setConflicts,
    resolutions,
    setResolutions,
    redeeming,
    redeemError,
    destinationError,
    setDestinationError,
    loadPreview,
    act,
    continueMerge,
  };
}
