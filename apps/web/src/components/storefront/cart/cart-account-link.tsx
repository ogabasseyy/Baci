'use client';

import type { CartMergeResolution, CartSnapshot } from '@baci/shared/cart';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useOptionalCustomerAuth } from '@/contexts/customer-auth-context';
import { useCart } from '@/hooks/cart';
import { clearCartStorage } from '@/hooks/cart/cart-persistence';
import {
  bootstrapSharedCart,
  fetchSharedCartSnapshot,
} from '@/hooks/cart/shared-cart-client';
import { useCartAccountLink } from '@/hooks/cart/use-cart-account-link';
import { planCartMerge } from '@/lib/cart/merge';

import { formatMinor } from './cart-handoff-support';

/**
 * Optional account continuity for signed-in shoppers. Guest checkout and
 * the save-details choice never trigger this; only an explicit button
 * here links the current cart or adopts the saved one.
 */
export function CartAccountLink(props: { merchantSlug?: string | null }) {
  const auth = useOptionalCustomerAuth();
  const cart = useCart();
  const {
    link,
    loadSavedCart,
    savedCart,
    savedCartLoaded,
    scopeKey,
    status,
    pending,
    retry,
  } = useCartAccountLink({
    merchantSlug: props.merchantSlug,
    ownerSubject: auth?.user?.id,
    onLinked: () => {
      // Account selection can switch to a lower-version cart. Start a new link
      // generation instead of polling it into the previous cart's reducer.
      clearCartStorage(props.merchantSlug);
    },
  });
  const [currentResult, setCurrent] = useState<{
    scope: string;
    snapshot: CartSnapshot;
  } | null>(null);
  const ownerScope = JSON.stringify([
    props.merchantSlug,
    auth?.user?.id,
    cart.sharedCartRef?.cartId,
  ]);
  const current =
    currentResult?.scope === ownerScope ? currentResult.snapshot : null;
  const [resolutions, setResolutions] = useState<CartMergeResolution[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const authenticated = Boolean(auth?.isAuthenticated);
  const sharedRef = cart.sharedCartRef;

  const ensureSavedCart = useCallback(async () => {
    // A fresh browser may hold no cart proof at all: establish the
    // bootstrap authority the account read/link requires before
    // loading the saved cart. The retry path repeats this sequence so
    // a failed bootstrap (network, 429, 503) can recover instead of
    // repeating an unauthorized account read.
    if (!sharedRef) {
      await bootstrapSharedCart(props.merchantSlug ?? undefined);
    }
    await loadSavedCart();
  }, [loadSavedCart, props.merchantSlug, sharedRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Stable loader reads scope from refs; merchant and shopper changes must trigger a fresh saved-cart observation.
  useEffect(() => {
    if (authenticated && cart.sharedCartAccountsEnabled) void ensureSavedCart();
  }, [
    authenticated,
    auth?.user?.id,
    props.merchantSlug,
    cart.sharedCartAccountsEnabled,
    ensureSavedCart,
    scopeKey,
  ]);

  if (!authenticated || !cart.sharedCartAccountsEnabled) return null;
  const choicesBlocked =
    !savedCartLoaded ||
    pending ||
    (sharedRef ? cart.syncStatus !== 'synced' : false);
  const saved = savedCart;
  const showChoices = Boolean(saved && saved.cartId !== sharedRef?.cartId);
  const plan =
    showChoices && saved && current
      ? planCartMerge(current, saved, resolutions)
      : null;
  const conflicts =
    plan && !plan.ok && plan.code === 'merge_conflict' ? plan.conflicts : [];

  async function prepareMerge(): Promise<void> {
    if (choicesBlocked) return;
    const scope = ownerScope;
    const result = await fetchSharedCartSnapshot(undefined, props.merchantSlug);
    if (!result.ok) {
      setNotice('We could not refresh your cart. Please try again.');
      return;
    }
    setCurrent({ scope, snapshot: result.snapshot });
    setResolutions([]);
  }

  return (
    <section
      aria-label="Cart account linking"
      className="mx-auto max-w-xl px-4 py-6"
    >
      <h2 className="text-base font-semibold">Cart and your account</h2>
      {notice ? (
        <p role="alert" className="mt-2 text-sm">
          {notice}
        </p>
      ) : null}
      {status === 'linked' ? (
        <p className="mt-2 text-sm">This cart is saved to your account.</p>
      ) : null}
      {status === 'loading' ? (
        <p role="status">Checking your saved cart…</p>
      ) : null}
      {!pending && status === 'error' ? (
        <Button type="button" onClick={() => void ensureSavedCart()}>
          Retry loading saved cart
        </Button>
      ) : null}
      {pending && status === 'error' ? (
        <Button type="button" onClick={() => void retry()}>
          Retry the same cart choice
        </Button>
      ) : null}
      {showChoices && saved ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm">
            Your account also has a saved cart (
            {formatMinor(saved.totalMinor, saved.currency)}). Choose what to
            keep; nothing changes until you pick.
          </p>
          {conflicts.map((conflict) => (
            <div key={JSON.stringify(conflict.item)} className="space-y-1">
              <p className="text-sm">
                One item has different offers in each cart.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={choicesBlocked}
                onClick={() =>
                  setResolutions((existing) => [
                    ...existing.filter(
                      (pick) =>
                        JSON.stringify(pick.item) !==
                        JSON.stringify(conflict.item)
                    ),
                    { item: conflict.item, keep: 'incoming' },
                  ])
                }
              >
                Keep saved offer
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={choicesBlocked}
                onClick={() =>
                  setResolutions((existing) => [
                    ...existing.filter(
                      (pick) =>
                        JSON.stringify(pick.item) !==
                        JSON.stringify(conflict.item)
                    ),
                    { item: conflict.item, keep: 'existing' },
                  ])
                }
              >
                Keep current offer
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={choicesBlocked}
              onClick={() => void link('use_saved')}
            >
              Use saved cart
            </Button>
            {sharedRef ? (
              plan?.ok ? (
                <Button
                  type="button"
                  disabled={choicesBlocked}
                  onClick={() =>
                    void link('merge', {
                      lines: plan.lines,
                      resolutions,
                      expectedSavedVersion: saved.version,
                      expectedCurrentVersion:
                        current?.version ?? sharedRef.version,
                    })
                  }
                >
                  Combine both carts
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={choicesBlocked}
                  onClick={() => void prepareMerge()}
                >
                  Review combining both carts
                </Button>
              )
            ) : null}
          </div>
        </div>
      ) : sharedRef ? (
        <div className="mt-3">
          <Button
            type="button"
            disabled={choicesBlocked}
            onClick={() => void link('keep_current')}
          >
            Save this cart to my account
          </Button>
        </div>
      ) : null}
      {status === 'error' ? (
        <p role="alert" className="mt-2 text-sm">
          {pending
            ? 'Linking was interrupted. Retry finishes the same request.'
            : 'We could not check your saved cart. Retry before choosing what to keep.'}
        </p>
      ) : null}
    </section>
  );
}
