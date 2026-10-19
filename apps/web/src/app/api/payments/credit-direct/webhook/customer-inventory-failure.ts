import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { rollbackOrderStatusAfterInventoryConfirmationFailure } from '@/lib/payments/ensure-paid-order-inventory-confirmed';
import { fileInventoryConfirmationFailureReview } from '@/lib/payments/file-inventory-confirmation-review';
import { buildInventoryConfirmationFailurePayload } from '@/lib/payments/inventory-confirmation-response';

export interface CustomerInventoryFailure {
  supabase: SupabaseClient;
  merchantId: string;
  orderId: string;
  /** Pre-webhook statuses to restore; the branch sets no amount_paid. */
  previousPaymentStatus: string | null;
  previousShippingStatus: string | null;
  gatewayReference: string | null;
  inventoryError: unknown;
}

/**
 * Handles a customer-branch inventory-confirmation failure: rolls the
 * bnpl_approved flip back so the status poll cannot confirm an order
 * with unconfirmed inventory, files a reconciliation review when the
 * rollback itself fails, and maps the outcome to the
 * serialized-unavailable (409) / failed (500) response contract.
 * The restore is fenced to rows still in bnpl_approved — a concurrent
 * merchant webhook may settle the order while confirmation is in
 * flight. Extracted from the webhook route (Boy Scout rule).
 */
export async function respondCustomerInventoryFailure(
  input: CustomerInventoryFailure
): Promise<NextResponse> {
  const {
    supabase,
    merchantId,
    orderId,
    previousPaymentStatus,
    previousShippingStatus,
    gatewayReference,
    inventoryError,
  } = input;

  logger.error({
    message:
      'Credit-direct webhook customer branch failed to confirm inventory',
    orderId,
    error: inventoryError,
  });

  try {
    await rollbackOrderStatusAfterInventoryConfirmationFailure(
      supabase,
      merchantId,
      orderId,
      {
        payment_status: previousPaymentStatus,
        shipping_status: previousShippingStatus,
      },
      { onlyIfPaymentStatus: ['bnpl_approved'] }
    );
  } catch (rollbackError) {
    await fileInventoryConfirmationFailureReview({
      gatewayReference,
      merchantId,
      metadata: {
        inventoryError:
          inventoryError instanceof Error
            ? inventoryError.message
            : inventoryError,
        rollbackError:
          rollbackError instanceof Error
            ? rollbackError.message
            : rollbackError,
        source: 'credit_direct_customer_inventory_confirmation_rollback',
      },
      orderId,
      reason:
        'Credit Direct customer approval reached bnpl_approved state, but serialized inventory confirmation and status rollback both failed.',
      transactionId: null,
    });
    return NextResponse.json(
      {
        code: 'INVENTORY_CONFIRMATION_CLEANUP_FAILED',
        error: 'Inventory confirmation cleanup failed',
      },
      { status: 500 }
    );
  }

  const responsePayload =
    buildInventoryConfirmationFailurePayload(inventoryError);
  return NextResponse.json(responsePayload, {
    status:
      responsePayload.code === 'serialized_inventory_unavailable' ? 409 : 500,
  });
}
