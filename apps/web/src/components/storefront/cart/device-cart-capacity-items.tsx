'use client';
// Uses React state/effects and browser storage to edit saved cart lines.

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  rotateCartCookieEpoch,
  withCartCookieWrite,
} from '@/hooks/cart/cart-cross-tab-lock';
import {
  getCartFromStorage,
  getCartWideNegotiationFromStorage,
  saveCartToStorage,
  saveCartWideNegotiationToStorage,
} from '@/hooks/cart/cart-storage';
import type { CartItem } from '@/hooks/cart/cart-types';
import {
  displayLineMatchesAddLane,
  identityKeyOfDisplay,
} from '@/hooks/cart/shared-cart-display-identity';
import { removeCapacityLineFromLiveCart } from '@/hooks/cart/shared-cart-live-removal';
import { subscribeCartSessionGeneration } from '@/hooks/cart/shared-cart-storage';

/** Edit only the parked merchant-scoped device cache, before any create exists. */
export function DeviceCartCapacityItems({
  merchantSlug,
}: {
  merchantSlug: string;
}) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setItems(getCartFromStorage(merchantSlug));
  }, [merchantSlug]);
  // Keep the panel in sync with parked-cache writes from this tab's
  // provider or other tabs while it stays open.
  useEffect(
    () =>
      subscribeCartSessionGeneration(() =>
        setItems(getCartFromStorage(merchantSlug))
      ),
    [merchantSlug]
  );
  function remove(index: number) {
    const selected = items[index];
    if (!selected) return;
    // Serialize the edit with in-flight creates in other tabs through
    // the origin-wide cookie-writer lock: the cache is re-read and the
    // epoch rotated only once any active creator has finished, so a
    // cloned pre-removal request cannot resurrect the removed line.
    const signal =
      typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(5_000)
        : new AbortController().signal;
    let applied = false;
    let removed = false;
    let write: Promise<unknown>;
    try {
      write = withCartCookieWrite(
        undefined,
        signal,
        () => {
          applied = true;
          removed = applyRemoval(selected);
          return Promise.resolve(undefined);
        },
        merchantSlug
      );
    } catch {
      // A secure browser without Web Locks throws synchronously from
      // the lock manager: surface feedback instead of a dead click.
      setItems(getCartFromStorage(merchantSlug));
      setError('Could not save that change. Check storage access and retry.');
      return;
    }
    void write
      .then(() => {
        if (!applied) {
          setItems(getCartFromStorage(merchantSlug));
          setError(
            'Could not save that change. Check storage access and retry.'
          );
          return;
        }
        if (!removed) {
          // Another tab already removed this row: only the winning
          // edit may reconcile the live cart, or the quantity would
          // be subtracted twice.
          setItems(getCartFromStorage(merchantSlug));
          return;
        }
        // A create in another tab may have committed while this removal
        // was queued behind it; the cache edit cannot undo that create,
        // so remove the line from the now-live server cart as well.
        void removeCapacityLineFromLiveCart(selected, merchantSlug).then(
          (ok) => {
            if (!ok)
              setError(
                'Saved items updated, but the live cart could not be updated. Remove the item from the cart and retry.'
              );
          }
        );
      })
      .catch(() => {
        setItems(getCartFromStorage(merchantSlug));
        setError('Could not save that change. Check storage access and retry.');
      });
  }
  function applyRemoval(selected: CartItem): boolean {
    const current = getCartFromStorage(merchantSlug);
    const matchesSelected = (item: CartItem) =>
      identityKeyOfDisplay(item) === identityKeyOfDisplay(selected) &&
      item.offerId === selected.offerId &&
      displayLineMatchesAddLane(item, {
        voucherToken: selected.quizVoucherToken,
        voucherAwardId: selected.quizAwardId,
        negotiatedUnitPriceMinor:
          selected.negotiatedPrice == null
            ? undefined
            : Math.round(selected.negotiatedPrice * 100),
        negotiationStatus: selected.negotiationStatus,
      });
    const candidates = current.filter(matchesSelected);
    // A stable saved ID survives reordering and quantity edits, but
    // synthesized legacy IDs repeat across duplicate rows: an ID only
    // identifies the row when it is unique in storage. Otherwise remove
    // the occurrence matching the distinguishing quantity/assurance
    // fields, preserving differently-configured siblings.
    const sameId = current.filter(
      (item) => item.cartItemId === selected.cartItemId
    );
    const idIsAuthoritative =
      Boolean(selected.cartItemId) && sameId.length === 1;
    const target = idIsAuthoritative
      ? (candidates.find((item) => item.cartItemId === selected.cartItemId) ??
        sameId[0])
      : candidates.length === 1 &&
          items.filter(matchesSelected).length === 1 &&
          !candidates[0].cartItemId
        ? candidates[0]
        : candidates.find(
            (item) =>
              item.quantity === selected.quantity &&
              (item.hasAssurance ?? false) ===
                (selected.hasAssurance ?? false) &&
              item.assuranceRate === selected.assuranceRate
          );
    if (!target) {
      setItems(current);
      return false;
    }
    const targetIndex = current.indexOf(target);
    let remaining = current.filter(
      (_, currentIndex) => currentIndex !== targetIndex
    );
    const hadGroupNegotiation = getCartWideNegotiationFromStorage(merchantSlug);
    if (hadGroupNegotiation) {
      remaining = remaining.map(
        ({ negotiatedPrice: _price, negotiationStatus: _status, ...item }) =>
          item
      );
    }
    // Fence provisioning in every tab before rewriting the parked
    // cache: rotating the shared epoch bumps other tabs' session
    // generations, so a create cloned before the removal is discarded
    // instead of resurrecting the removed line.
    rotateCartCookieEpoch(merchantSlug);
    saveCartToStorage(remaining, merchantSlug);
    // Storage writes can fail silently (quota/blocked): only hide the
    // line once the persisted cache actually reflects the removal.
    const persisted = getCartFromStorage(merchantSlug);
    const persistedOk =
      persisted.length === remaining.length &&
      persisted.every(
        (item, index) =>
          item.cartItemId === remaining[index].cartItemId &&
          item.quantity === remaining[index].quantity
      );
    if (!persistedOk) {
      setItems(persisted);
      setError('Could not save that change. Check storage access and retry.');
      return false;
    }
    // Clear the group-deal flag only once the stripped cache is known
    // to be persisted; a failed write must keep it for the retry.
    if (hadGroupNegotiation)
      saveCartWideNegotiationToStorage(false, merchantSlug);
    setError(null);
    setItems(remaining);
    return true;
  }
  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      <ul aria-label="Saved device cart items">
        {items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stateless rows may share product IDs; no offer credentials enter React keys.
          <li key={`${item.cartItemId ?? item.id}-${index}`}>
            <span>
              {item.name} {item.selectedColor} {item.selectedStorage} ×{' '}
              {item.quantity}
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => remove(index)}
            >
              Remove {item.name}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
