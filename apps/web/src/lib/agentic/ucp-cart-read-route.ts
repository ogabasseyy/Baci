import type { SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import type { AgenticMerchantContext } from './merchant-context';
import type { handleCanonicalUcpCart } from './ucp-canonical-cart';
import type { buildUcpCartStateResponse } from './ucp-cart-route-support';
import type { loadUcpCartSession } from './ucp-cart-session-read';
import { coerceUcpCartItems, ucpCartCallerMismatch } from './ucp-cart-storage';

type CanonicalResult = { body: Record<string, unknown>; status: number };

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

function normalizeOptions(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return JSON.stringify(
    Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    )
  );
}

function canonicalHasLanes(
  canonical: CanonicalResult,
  lanes: {
    productId: string;
    variantId?: string;
    condition?: string;
    options?: Record<string, string>;
  }[]
): boolean {
  const lineItems = (canonical.body as { line_items?: unknown }).line_items;
  if (!Array.isArray(lineItems)) return false;
  const seen = new Set(
    lineItems.map((line) => {
      const item = (line as { item?: Record<string, unknown> }).item ?? {};
      return JSON.stringify([
        item.id ?? item.product_id ?? null,
        item.variant_id ?? null,
        item.condition ?? null,
        normalizeOptions(item.variant_attributes),
      ]);
    })
  );
  return lanes.every((lane) =>
    seen.has(
      JSON.stringify([
        lane.productId,
        lane.variantId ?? null,
        lane.condition ?? null,
        normalizeOptions(lane.options),
      ])
    )
  );
}

/**
 * True when canonical lanes are still the generic create-time
 * projection of the stored lanes (same products and quantities, no
 * variant/condition identity yet). Anything else means a legitimate
 * update has landed since create, so the stored lanes must never be
 * replayed over it.
 */
function canonicalIsGenericProjection(
  canonical: CanonicalResult,
  lanes: {
    productId: string;
    quantity: number;
  }[]
): boolean {
  const lineItems = (canonical.body as { line_items?: unknown }).line_items;
  if (!Array.isArray(lineItems) || lineItems.length !== lanes.length)
    return false;
  const expected = new Map(
    lanes.map((lane) => [lane.productId, lane.quantity])
  );
  return lineItems.every((line) => {
    const item = (line as { item?: Record<string, unknown> }).item ?? {};
    const productId = item.id;
    if (typeof productId !== 'string') return false;
    if (item.variant_id || item.condition) return false;
    return expected.get(productId) === item.quantity;
  });
}

/** Clears the one-shot create-recovery marker; false when it stays set. */
async function clearRecoveryMarker(
  input: {
    cartId: string;
    merchant: AgenticMerchantContext;
    supabase: SupabaseClient;
  },
  cart: unknown
): Promise<boolean> {
  const metadata = (cart as { metadata?: unknown }).metadata;
  const loadedUpdatedAt = (cart as { updated_at?: unknown }).updated_at;
  let clearQuery = input.supabase
    .from('agentic_cart_sessions')
    .update({
      metadata: {
        ...(metadata && typeof metadata === 'object'
          ? (metadata as Record<string, unknown>)
          : {}),
        create_recovery_pending: false,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('cart_id', input.cartId)
    .eq('merchant_id', input.merchant.id);
  if (typeof loadedUpdatedAt === 'string') {
    clearQuery = clearQuery.eq('updated_at', loadedUpdatedAt);
  }
  const { data: clearedRows, error: clearError } =
    await clearQuery.select('cart_id');
  if (clearError) {
    logger.error({
      error: sanitizeForLog(clearError),
      merchantId: input.merchant.id,
      message: 'Failed to clear UCP create recovery marker',
      route: 'ucp-cart-read',
    });
    return false;
  }
  if (clearedRows.length === 0) {
    logger.error({
      merchantId: input.merchant.id,
      message: 'UCP create recovery marker clear lost a concurrent write race',
      route: 'ucp-cart-read',
    });
    return false;
  }
  return true;
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
          // lanes are stale. Retire the marker and answer canonical.
          await clearRecoveryMarker(input, cartResult.cart);
          return NextResponse.json(canonical.body, {
            status: canonical.status,
          });
        }
      }
      if (lanes) {
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
