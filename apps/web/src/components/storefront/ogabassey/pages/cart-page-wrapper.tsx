'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/hooks/cart';
import { useToast } from '@/hooks/use-toast';
import { fetchAndAddCartItems } from '@/lib/cart-link-transfer';
import { resolveGuestCartTransfer } from '@/lib/resolve-guest-cart-transfer';
import {
  cartHandoffPairingTokenSchema,
  cartHandoffPreviewQuerySchema,
  cartHandoffRedeemRequestSchema,
} from '@/schemas/cart';
import { CartAccountLink } from '../../cart/cart-account-link';
import { CartHandoff } from '../../cart/cart-handoff';
import {
  clearActiveHandoff,
  loadActiveHandoff,
  recordActiveHandoff,
  redactHandoffFragment,
  reloadCartHandoffDocument,
} from '../../cart/cart-handoff-support';
import { CartImportConflicts } from '../../cart/cart-import-conflicts';
import { CartPage } from './cart-page';

interface CartPageWrapperProps {
  merchantId: string;
  merchantSlug?: string;
  vatEnabled?: boolean;
  vatRate?: number;
}

/**
 * Cart page wrapper that handles item_id query parameter for direct add-to-cart links.
 * Supports URLs like: /cart?item_id=123 or /cart?item_id=123,456,789
 * Used by ChatGPT MCP integration and Google Shopping.
 *
 * A shared-cart pairing fragment (`/cart#handoff=<token>&hid=<id>`) mounts
 * the handoff continuation instead: the secret lives in the fragment so it
 * never reaches the server, and the one-time transfer links keep working
 * unchanged when no pairing is present.
 */
export function CartPageWrapper({ merchantId, merchantSlug, vatEnabled = false, vatRate = 7.5 }: CartPageWrapperProps) {
  const searchParams = useSearchParams();
  const { addToCart, cart, importStatus, isHydrated, sharedCartEnabled } = useCart();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  // Both server and browser render the same initial tree; read the fragment
  // after hydration and retain it when the continuation strips the URL.
  const [pairing, setPairing] = useState<ReturnType<typeof parseHandoffPairing>>(null);
  const [pairingChecked, setPairingChecked] = useState(false);
  const capturedPairing = useRef(false);
  useEffect(() => {
    if (capturedPairing.current) return;
    capturedPairing.current = true;
    // After a reload the fragment is already redacted; fall back to
    // the tab-scoped locator recorded before redaction so an
    // unresolved handoff (and its persisted attempt) stays reachable.
    // A locator scoped to a different merchant must not restore on
    // this merchant's cart page.
    const locator = loadActiveHandoff();
    const scopedLocator =
      locator &&
      (!merchantSlug ||
        !locator.merchantSlug ||
        locator.merchantSlug === merchantSlug)
        ? locator
        : null;
    const fragment = parseHandoffPairing(window.location.hash);
    if (fragment) {
      recordActiveHandoff(fragment.token, fragment.handoffId, merchantSlug);
      redactHandoffFragment();
    }
    setPairing(fragment ?? scopedLocator);
    setPairingChecked(true);
  }, [merchantSlug]);

  useEffect(() => {
    let reloading = false;
    const cartPath = window.location.pathname;
    let previousHash = window.location.hash;
    function acceptHandoffNavigation() {
      const hash = window.location.hash;
      if (reloading || window.location.pathname !== cartPath || hash === previousHash) return;
      previousHash = hash;
      const handoff = parseHandoffPairing(hash);
      if (
        !handoff ||
        !cartHandoffPairingTokenSchema.safeParse(handoff.token).success ||
        !cartHandoffRedeemRequestSchema.shape.token.safeParse(handoff.token).success ||
        !cartHandoffPreviewQuerySchema.safeParse({ handoff_id: handoff.handoffId }).success
      ) return;

      // The mounted cart can still have a bootstrap in flight. A reload
      // enters through the existing handoff gate before that bootstrap starts.
      reloading = true;
      reloadCartHandoffDocument();
    }

    const navigation = window.navigation;
    // History API writes can change the fragment without emitting hashchange.
    navigation?.addEventListener('currententrychange', acceptHandoffNavigation);
    const legacyHistoryCheck = navigation
      ? undefined
      : window.setInterval(acceptHandoffNavigation, 1000);
    window.addEventListener('hashchange', acceptHandoffNavigation);
    return () => {
      navigation?.removeEventListener('currententrychange', acceptHandoffNavigation);
      window.clearInterval(legacyHistoryCheck);
      window.removeEventListener('hashchange', acceptHandoffNavigation);
    };
  }, []);
  const processedRef = useRef(false);
  const blockedNoticeRef = useRef(false);

  useEffect(() => {
    // A pairing owns the surface: importing link items into the local cart
    // underneath the continuation choice would corrupt the merge decision.
    if (!pairingChecked || pairing) return;
    const guestTransfer = resolveGuestCartTransfer(searchParams.get('guest_cart'));
    const itemIds = guestTransfer ? guestTransfer.itemIds : searchParams.get('item_id');
    const rawQuantity = searchParams.get('qty');
    const parsedQuantity = rawQuantity && /^\d+$/.test(rawQuantity) ? Number(rawQuantity) : 1;
    const quantity = Number.isSafeInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 10
      ? parsedQuantity
      : 1;
    const quizAwardId = searchParams.get('quiz_award_id')?.trim() || null;
    const quizVoucherToken =
      searchParams.get('quiz_voucher_token')?.trim() || null;
    const variantId = searchParams.get('variant_id')?.trim() || undefined;
    const condition = searchParams.get('condition')?.trim() || undefined;

    // Wait for the persisted cart to hydrate before processing. On a cold load
    // from a prize link the cart is empty until StorefrontCartProvider restores
    // localStorage in its own effect; running now would let the mixed-cart
    // guard read an empty cart and add the prize alongside a shopper's
    // already-persisted paid items (which the server then rejects). Gating on
    // `isHydrated` (and keeping it in the dep list) defers the single run until
    // the real cart is present. Only process once, and only if item_id exists.
    if (!isHydrated || !itemIds || processedRef.current) return;

    // Mixed-cart guard, BEFORE the link is marked processed: a prize is redeemed
    // as its OWN order (the server rejects a cart mixing the voucher with paid
    // items). If other items are present, notify once and return WITHOUT
    // consuming the link — once the shopper empties/checks out those items the
    // effect reruns (cart is a dep) and the prize can still be claimed, instead
    // of being permanently stuck behind `processedRef`. Re-claiming the SAME
    // award is fine (deduped in fetchAndAddCartItems).
    const hasQuizPrizeVoucher = Boolean(!guestTransfer && quizAwardId && quizVoucherToken);
    if (
      (hasQuizPrizeVoucher && cart.some((item) => item.quizAwardId !== quizAwardId)) ||
      (guestTransfer && cart.some((item) => item.quizAwardId))
    ) {
      if (!blockedNoticeRef.current) {
        blockedNoticeRef.current = true;
        toast({
          title: 'Check out your prize separately',
          description:
            'Your cart has other items. Check out or empty your cart first, then claim your prize.',
          variant: 'destructive',
        });
      }
      return;
    }
    blockedNoticeRef.current = false;
    processedRef.current = true;

    // A failed attempt releases the link so a later effect run (e.g. after the
    // cart changes) retries it instead of forcing a full page reload.
    void fetchAndAddCartItems({
      itemIds,
      quantity,
      guestQuantities: guestTransfer?.quantities,
      quizAwardId,
      quizVoucherToken,
      variantId,
      condition,
      merchantId,
      cart,
      addToCart,
      toast,
      setIsLoading,
    }).then((succeeded) => { if (!succeeded) processedRef.current = false; });
  }, [searchParams, merchantId, addToCart, cart, toast, isHydrated, pairing, pairingChecked]);

  // Let the website's saved device cart finish adoption before an additive
  // handoff. Otherwise adoption could reconcile two distinct adds as one.
  const waitingForLocalImport =
    !!pairing && sharedCartEnabled &&
    (!isHydrated || importStatus === 'pending' ||
      (importStatus === 'none' && cart.length > 0));
  if (pairing && sharedCartEnabled && importStatus === 'failed') {
    return (
      <section aria-label="Cart handoff" className="mx-auto max-w-xl px-4 py-10">
        <p role="alert">Review the items saved on this device before opening this cart link again.</p>
        <Button type="button" onClick={() => {
          clearActiveHandoff(pairing.handoffId);
          window.location.replace(window.location.pathname + window.location.search);
        }}>
          View website cart
        </Button>
      </section>
    );
  }
  if (pairing && !waitingForLocalImport) {
    return <CartHandoff token={pairing.token} handoffId={pairing.handoffId} />;
  }

  // Until the fragment check completes, the ordinary subtree (whose
  // account panel bootstraps on mount) must stay unmounted: its
  // uncancellable bootstrap could land after handoff redemption and
  // overwrite the cart-bound proof with a cart-less one.
  if (!pairingChecked || waitingForLocalImport || !isHydrated || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-store-background">
        <div className="text-center" role="status">
          <div className="mx-auto mb-4 size-12 animate-spin rounded-full border-4 border-store-background-text/18 border-t-(--store-primary)" />
          <p className="text-store-background-text/65">
            {isHydrated && !waitingForLocalImport ? 'Adding items to cart…' : 'Loading your cart…'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <CartImportConflicts />
      <CartAccountLink merchantSlug={merchantSlug} />
      <CartPage vatEnabled={vatEnabled} vatRate={vatRate} />
    </>
  );
}

function parseHandoffPairing(hash: string): { token: string; handoffId: string } | null {
  if (!hash || hash === '#') return null;
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get('handoff');
  const handoffId = params.get('hid');
  if (!token || !handoffId) return null;
  return { token, handoffId };
}
