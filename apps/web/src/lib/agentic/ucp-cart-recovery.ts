import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import type { AgenticMerchantContext } from './merchant-context';

export type CanonicalResult = { body: Record<string, unknown>; status: number };

export function normalizeOptions(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return JSON.stringify(
    Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    )
  );
}

export function canonicalHasLanes(
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
export function canonicalIsGenericProjection(
  canonical: CanonicalResult,
  lanes: {
    productId: string;
    variantId?: string;
    condition?: string;
    options?: Record<string, string>;
    quantity: number;
  }[]
): boolean {
  const lineItems = (canonical.body as { line_items?: unknown }).line_items;
  if (!Array.isArray(lineItems) || lineItems.length !== lanes.length)
    return false;
  const expected = new Map(
    lanes.map((lane) => [
      JSON.stringify([
        lane.productId,
        null,
        null,
        normalizeOptions(lane.options),
        lane.quantity,
      ]),
      true,
    ])
  );
  // Generic projection means canonical lanes carry no MORE identity
  // than the stored lanes: same product, quantity, and normalized
  // options, with no variant/condition identity the create never had.
  return lineItems.every((line) => {
    const item = (line as { item?: Record<string, unknown> }).item ?? {};
    if (typeof item.id !== 'string') return false;
    if (item.variant_id || item.condition) return false;
    return expected.has(
      JSON.stringify([
        item.id,
        null,
        null,
        normalizeOptions(item.variant_attributes),
        item.quantity,
      ])
    );
  });
}

/** Clears the one-shot create-recovery marker; false when it stays set. */
export async function clearRecoveryMarker(
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
