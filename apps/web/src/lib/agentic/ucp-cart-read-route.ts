import type { SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import type { AgenticMerchantContext } from './merchant-context';
import type { handleCanonicalUcpCart } from './ucp-canonical-cart';
import {
  canonicalHasLanes,
  canonicalIsGenericProjection,
  clearRecoveryMarker,
} from './ucp-cart-recovery';
import type { buildUcpCartStateResponse } from './ucp-cart-route-support';
import type { loadUcpCartSession } from './ucp-cart-session-read';
import { coerceUcpCartItems, ucpCartCallerMismatch } from './ucp-cart-storage';

function storedLaneLines(cart: { cart_items: unknown } | null):
  | {
      productId: string;
      variantId?: string;
      condition?: string;
      options?: Record<string, string>;
      quantity: number;
    }[]
  | null {
  if (!cart) return null;
  // Recovery is a one-shot create repair: only a row whose create
  // replace never committed (marker still pending) may be replayed.
  // Once the marker clears, canonical state is authoritative and
  // legitimate updates must never be reverted to the original lanes.
  const metadata = (cart as { metadata?: unknown }).metadata;
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    (metadata as Record<string, unknown>).create_recovery_pending !== true
  )
    return null;
  const items = coerceUcpCartItems(cart.cart_items);
  if (
    !items.some(
      (item) => item.variant_id || item.condition || item.variant_attributes
    )
  )
    return null;
  return items.map((item) => ({
    productId: item.id,
    ...(item.variant_id ? { variantId: item.variant_id } : {}),
    ...(item.condition ? { condition: item.condition } : {}),
    ...(item.variant_attributes ? { options: item.variant_attributes } : {}),
    quantity: item.quantity,
  }));
}

/** Reads through the authority supplied by the authenticated route. */
export async function readUcpCart(
  input: {
    request: NextRequest;
    cartId: string;
    agentId: string | null;
    merchant: AgenticMerchantContext;
    supabase: SupabaseClient;
  },
  deps: {
    canonical: typeof handleCanonicalUcpCart;
    load: typeof loadUcpCartSession;
    respond: typeof buildUcpCartStateResponse;
  }
) {
  const canonical = await deps.canonical({
    merchant: input.merchant,
    cartId: input.cartId,
    agentId: input.agentId,
    action: 'read',
  });
  if (canonical) {
    // Recovery: a create whose full-identity replace failed after the
    // canonical migration committed leaves the durable session row
    // holding the requested lanes while the canonical cart holds the
    // generic projection. Replay the stored lanes once (stable
    // operation identity) so the shopper continues with the variant
    // or condition they actually requested.
    if (canonical.status === 200) {
      const cartResult = await deps.load({
        cartId: input.cartId,
        merchantId: input.merchant.id,
        supabase: input.supabase,
      });
      const lanes =
        cartResult &&
        !cartResult.error &&
        cartResult.cart &&
        !ucpCartCallerMismatch(cartResult.cart, input.agentId)
          ? storedLaneLines(cartResult.cart)
          : null;
      // Even when the canonical lanes already match, a still-pending
      // marker must be retried here: if the create-time clear failed,
      // this read is the only place that can retire it before a later
      // legitimate lane update makes the stale lanes replayable.
      if (lanes && !canonicalHasLanes(canonical, lanes)) {
        if (!canonicalIsGenericProjection(canonical, lanes)) {
          // A legitimate update has landed since create: the stored
          // lanes are stale. Retire the marker and answer canonical;
          // if retirement fails the marker stays armed, so fail
          // closed instead of reporting success.
          const retired = await clearRecoveryMarker(input, cartResult.cart);
          if (!retired) {
            return NextResponse.json(
              { code: 'temporarily_unavailable' },
              { status: 503 }
            );
          }
          return NextResponse.json(canonical.body, {
            status: canonical.status,
          });
        }
      }
      if (lanes) {
        const observedVersion = canonical.body.cart_version;
        const recovered = canonicalHasLanes(canonical, lanes)
          ? canonical
          : await deps.canonical({
              merchant: input.merchant,
              cartId: input.cartId,
              agentId: input.agentId,
              action: 'update',
              lines: lanes.map((lane) => ({
                item: {
                  productId: lane.productId,
                  ...(lane.variantId ? { variantId: lane.variantId } : {}),
                  ...(lane.condition
                    ? { condition: lane.condition as never }
                    : {}),
                  ...(lane.options ? { options: lane.options } : {}),
                },
                quantity: lane.quantity,
              })),
              operationId: `ucp-create-recovery:${input.cartId}`,
              // Fence the replay with the version observed on the
              // initial read: a legitimate update that landed since
              // must conflict, never be overwritten by stale lanes.
              ...(typeof observedVersion === 'number' &&
              Number.isSafeInteger(observedVersion) &&
              observedVersion >= 0
                ? { expectedVersion: observedVersion }
                : {}),
            });
        if (recovered && recovered.status === 200) {
          // One-shot repair completes only when the marker actually
          // clears; completing with it still set would leave the
          // stored lanes replayable over a later legitimate update.
          const markerCleared = await clearRecoveryMarker(
            input,
            cartResult.cart
          );
          if (!markerCleared) {
            return NextResponse.json(
              { code: 'temporarily_unavailable' },
              { status: 503 }
            );
          }
          const fresh = await deps.canonical({
            merchant: input.merchant,
            cartId: input.cartId,
            agentId: input.agentId,
            action: 'read',
          });
          if (!fresh) {
            return NextResponse.json(
              { code: 'temporarily_unavailable' },
              { status: 503 }
            );
          }
          return NextResponse.json(fresh.body, { status: fresh.status });
        }
        if (recovered !== canonical) {
          // The recovery update failed (conflict, transient error, or
          // the canonical path closed): the generic projection is
          // known to be missing the requested lane, so propagate the
          // failure instead of reporting it as a successful read.
          if (!recovered) {
            return NextResponse.json(
              { code: 'temporarily_unavailable' },
              { status: 503 }
            );
          }
          return NextResponse.json(recovered.body, {
            status: recovered.status,
          });
        }
      }
    }
    return NextResponse.json(canonical.body, { status: canonical.status });
  }

  const cartResult = await deps.load({
    cartId: input.cartId,
    merchantId: input.merchant.id,
    supabase: input.supabase,
  });
  if (cartResult.error) {
    logger.error({
      error: sanitizeForLog(cartResult.error),
      message: 'Failed to read UCP cart',
      route: 'carts.get',
    });
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
  if (!cartResult.cart) {
    return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
  }
  if (ucpCartCallerMismatch(cartResult.cart, input.agentId)) {
    return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
  }

  return deps.respond({
    cart: cartResult.cart,
    merchant: input.merchant,
    request: input.request,
    supabase: input.supabase,
  });
}
