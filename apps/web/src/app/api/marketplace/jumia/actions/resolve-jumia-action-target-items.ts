import { NextResponse } from 'next/server';
import type { JumiaClient } from '@/lib/jumia/client';
import { getOrderItems } from '@/lib/jumia/orders';
import { logger } from '@/lib/logger';

export type JumiaActionTargetItems =
  | { ok: true; isAllItems: boolean }
  | { ok: false; response: Response };

/**
 * Validates explicit fulfillment item IDs against the provider's complete
 * item set for the order. Rejects IDs from other orders (acting on them
 * would leave that order's local status stale) and reports whether the
 * IDs cover the whole order. Fails closed when ownership cannot be
 * verified.
 */
export async function resolveJumiaActionTargetItems(
  jumiaClient: JumiaClient,
  orderId: string,
  targetItemIds: string[]
): Promise<JumiaActionTargetItems> {
  try {
    const orderItems = await getOrderItems(jumiaClient, orderId);
    const orderItemIds = new Set(
      orderItems?.items?.map((item) => item.id) ?? []
    );
    const suppliedIds = new Set(targetItemIds);
    const foreignIds = [...suppliedIds].filter((id) => !orderItemIds.has(id));
    if (foreignIds.length > 0) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Some items do not belong to this order' },
          { status: 400 }
        ),
      };
    }
    return {
      ok: true,
      isAllItems:
        orderItemIds.size > 0 &&
        suppliedIds.size === orderItemIds.size &&
        orderItems.items.every((item) => suppliedIds.has(item.id)),
    };
  } catch (error: unknown) {
    logger.warn({ message: 'Jumia all-items check failed', error });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unable to verify order items with Jumia. Try again.' },
        { status: 502 }
      ),
    };
  }
}
