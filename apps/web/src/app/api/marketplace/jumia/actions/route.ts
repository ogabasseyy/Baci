import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { JumiaClient } from '@/lib/jumia/client';
import { cancelItems, printLabels, readyToShip } from '@/lib/jumia/fulfillment';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { getOrderItems } from '@/lib/jumia/orders';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { integrationIdSchema } from '@/schemas/marketplace';
import { executePackAction } from './pack-action';
import { updateJumiaActionOrderStatus } from './sync-jumia-action-status';

/** Derive overall action status from Jumia success/error totals */
function computeActionStatus(
  successTotal: number,
  errorTotal: number
): 'full' | 'partial' | 'failed' {
  if (successTotal === 0 && errorTotal === 0) return 'failed';
  if (errorTotal === 0) return 'full';
  if (successTotal > 0) return 'partial';
  return 'failed';
}

/** Update local order status and return a sync warning if a DB write fails */
function updateOrderStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  merchantId: string,
  newStatus: string
) {
  return updateJumiaActionOrderStatus(supabase, orderId, merchantId, newStatus);
}

const ActionSchema = z.object({
  action: z.enum(['pack', 'ready_to_ship', 'print_label', 'cancel']),
  integrationId: integrationIdSchema,
  orderId: z.string().trim().min(1, 'orderId is required'),
  itemIds: z
    .array(z.string().trim().min(1, 'itemId must not be empty'))
    .optional(),
  shipmentProviderId: z.string().trim().min(1).optional(),
  trackingCode: z.string().trim().min(1).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'integrations', 'manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = ActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const {
      action,
      integrationId,
      orderId,
      itemIds,
      shipmentProviderId,
      trackingCode,
    } = parsed.data;
    const merchantId = merchantContext.merchantId;

    let jumiaClient: JumiaClient;
    try {
      jumiaClient = await JumiaClient.forIntegration(
        supabase,
        merchantId,
        integrationId
      );
    } catch (err: unknown) {
      if (err instanceof JumiaApiError && err.status === 404) {
        return NextResponse.json(
          { error: `Jumia integration not found: ${integrationId}` },
          { status: 404 }
        );
      }
      throw err;
    }

    // Get item IDs if not provided
    // Track whether the caller targeted all items (eligible for order-level status update)
    let targetItemIds = itemIds;
    let isAllItems = false;
    if (!targetItemIds || targetItemIds.length === 0) {
      const orderItems = await getOrderItems(jumiaClient, orderId);
      if (!orderItems?.items?.length) {
        return NextResponse.json(
          { error: 'No order items found' },
          { status: 404 }
        );
      }
      targetItemIds = orderItems.items.map((i) => i.id);
      isAllItems = true;
    } else {
      // Explicit IDs can still cover the whole order: the order modal always
      // sends the full item list. Compare against the provider's complete set.
      try {
        const orderItems = await getOrderItems(jumiaClient, orderId);
        const suppliedIds = new Set(targetItemIds);
        isAllItems =
          !!orderItems?.items?.length &&
          orderItems.items.every((item) => suppliedIds.has(item.id));
      } catch (error: unknown) {
        // Proceed with the supplied IDs; only the order-level status sync is skipped.
        logger.warn({ message: 'Jumia all-items check failed', error });
      }
    }

    if (targetItemIds.length === 0) {
      return NextResponse.json(
        { error: 'No items found for this order' },
        { status: 400 }
      );
    }

    // Execute action
    switch (action) {
      case 'pack': {
        const packResult = await executePackAction({
          client: jumiaClient,
          targetItemIds,
          shipmentProviderId,
          trackingCode,
          isAllItems,
          orderId,
          merchantId,
          updateOrderStatus: (id, merchant, status) =>
            updateOrderStatus(supabase, id, merchant, status),
        });
        if ('error' in packResult) {
          return NextResponse.json(
            { error: packResult.error },
            { status: 400 }
          );
        }
        return NextResponse.json(packResult);
      }

      case 'ready_to_ship': {
        const rtsResult = await readyToShip(jumiaClient, targetItemIds);
        const rtsStatus = computeActionStatus(
          rtsResult.success?.total ?? 0,
          rtsResult.error?.total ?? 0
        );

        // Only update order-level status when ALL items were targeted (not a subset)
        const rtsSyncWarning =
          rtsStatus === 'full' && isAllItems
            ? await updateOrderStatus(
                supabase,
                orderId,
                merchantId,
                'ReadyToShip'
              )
            : undefined;

        return NextResponse.json({
          status: rtsStatus,
          successCount: rtsResult.success?.total ?? 0,
          errorCount: rtsResult.error?.total ?? 0,
          ...rtsSyncWarning,
        });
      }

      case 'print_label': {
        const labelResult = await printLabels(jumiaClient, targetItemIds);
        const successTotal = labelResult.success?.total ?? 0;
        const errorTotal = labelResult.error?.total ?? 0;
        const labels = labelResult.success?.labels ?? [];
        return NextResponse.json({
          status: computeActionStatus(successTotal, errorTotal),
          successCount: successTotal,
          errorCount: errorTotal,
          labels,
        });
      }

      case 'cancel': {
        const cancelResult = await cancelItems(jumiaClient, targetItemIds);
        const cancelStatus = computeActionStatus(
          cancelResult.success?.total ?? 0,
          cancelResult.error?.total ?? 0
        );

        // Only update order-level status when ALL items were targeted (not a subset)
        const cancelSyncWarning =
          cancelStatus === 'full' && isAllItems
            ? await updateOrderStatus(
                supabase,
                orderId,
                merchantId,
                'Cancelled'
              )
            : undefined;

        return NextResponse.json({
          status: cancelStatus,
          successCount: cancelResult.success?.total ?? 0,
          errorCount: cancelResult.error?.total ?? 0,
          ...cancelSyncWarning,
        });
      }

      default: {
        // Defense-in-depth: Zod validates the action enum above,
        // but guard against future schema/code drift.
        const _exhaustive: never = action;
        return NextResponse.json(
          { error: `Unknown action: ${_exhaustive}` },
          { status: 400 }
        );
      }
    }
  } catch (error: unknown) {
    logger.error({ message: 'Jumia Action Error', error });
    // ZodError check retained as defense-in-depth for any downstream schema parsing
    const rawStatus =
      error instanceof z.ZodError
        ? 400
        : (error as { status?: number })?.status;
    const status =
      typeof rawStatus === 'number' &&
      Number.isInteger(rawStatus) &&
      rawStatus >= 400 &&
      rawStatus <= 599
        ? rawStatus
        : 500;
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError ? 'Validation failed' : 'Action failed',
        details: error instanceof z.ZodError ? error.issues : undefined,
      },
      { status }
    );
  }
}
