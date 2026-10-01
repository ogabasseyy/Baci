import { after, type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { notifyOrderStatusChange } from '@/lib/expo-push';
import { maybeNotifyActivateProtection } from '@/lib/insurance/notify-activate-protection';
import { logger } from '@/lib/logger';
import { ORDER_COLUMNS, ORDER_WITH_ITEMS_QUERY } from '@/lib/order-queries';
import {
  ensurePaidOrderInventoryConfirmed,
  rollbackOrderStatusAfterInventoryConfirmationFailure,
} from '@/lib/payments/ensure-paid-order-inventory-confirmed';
import { fileInventoryConfirmationFailureReview } from '@/lib/payments/file-inventory-confirmation-review';
import { buildInventoryConfirmationFailurePayload } from '@/lib/payments/inventory-confirmation-response';
import { isFundedCheckoutGiglAddressLocked } from '@/lib/shipping/is-funded-checkout-gigl-address-locked';
import {
  claimOrderShipmentBooking,
  clearOrderShipmentBookingLock,
} from '@/lib/shipping/order-shipment-booking-lock';
import { shouldReleaseBookingLock } from '@/lib/shipping/order-shipment-booking-lock-errors';
import {
  isShippingProviderCode,
  OrderShipmentBookingError,
} from '@/lib/shipping/order-shipment-booking-utils';
import { runClaimedOrderWalletOrCheckoutBooking } from '@/lib/shipping/run-claimed-order-wallet-or-checkout-booking';
import { orderUpdateSchema } from '@/schemas/orders';
import { mapOrderPatchUpdateError } from './map-order-patch-update-error';

function isPaidStatusUpdate(value: unknown): value is 'paid' | 'bnpl_approved' {
  return value === 'paid' || value === 'bnpl_approved';
}

function runAfterResponse(task: () => Promise<void>) {
  const run = async () => {
    try {
      await task();
    } catch (err) {
      console.error('Deferred order side-effect failed:', err);
    }
  };

  try {
    after(run);
  } catch {
    void run();
  }
}

// GET /api/orders/[id] - Get a single order
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Authenticate request (supports mobile Bearer token + web cookies)
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get merchant ID (supports both owners and staff members)
    const merchantId = await getMerchantIdForApiUser(auth.supabase);
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const supabase = auth.supabase;

    // Get order (ensure it belongs to this merchant)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(ORDER_WITH_ITEMS_QUERY)
      .eq('id', id)
      .eq('merchant_id', merchantId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    return NextResponse.json({ order });
  } catch (error) {
    console.error('Unexpected error in GET /api/orders/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/orders/[id] - Update order status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CSRF protection
    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const { id } = await params;
    // Authenticate request (supports mobile Bearer token + web cookies)
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Malformed JSON body', code: 'INVALID_REQUEST_BODY' },
        { status: 400 }
      );
    }

    const parsedBody = orderUpdateSchema.safeParse(requestBody);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid request body', code: 'INVALID_REQUEST_BODY' },
        { status: 400 }
      );
    }

    // Get merchant ID (supports both owners and staff members)
    const merchantId = await getMerchantIdForApiUser(auth.supabase);
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const supabase = auth.supabase;
    let shipmentBookingLockToken: string | null = null;
    let inventoryConfirmedBeforeOrderUpdate = false;

    // Verify order belongs to this merchant and get current status
    const { data: existingOrder, error: checkError } = await supabase
      .from('orders')
      .select(
        'id, order_number, shipping_status, payment_status, payment_method, is_credit_order, customer_id, selected_quote_id, shipping_provider, shipping_funding_source, shipping_address, tracking_number, shipment_id'
      )
      .eq('id', id)
      .eq('merchant_id', merchantId)
      .single();

    if (checkError || !existingOrder) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Extract updatable fields
    const { payment_status, shipping_status, notes, shipping_address } =
      parsedBody.data;

    if (shipping_status === 'cancelled' || shipping_status === 'canceled') {
      return NextResponse.json(
        {
          error:
            'Use the cancellation endpoint so confirmation, inventory, refunds, and audit records remain consistent.',
          code: 'USE_CANCELLATION_ENDPOINT',
        },
        { status: 409 }
      );
    }

    // Validate: Cannot move to 'processing' unless paid or is_credit_order
    if (
      shipping_status === 'processing' &&
      existingOrder.shipping_status === 'pending' &&
      existingOrder.payment_status !== 'paid' &&
      !existingOrder.is_credit_order
    ) {
      return NextResponse.json(
        {
          error:
            'Order must be paid before processing. Use the credit order flow to ship unpaid orders.',
          code: 'PAYMENT_REQUIRED',
        },
        { status: 400 }
      );
    }

    if (
      shipping_status === 'shipped' &&
      existingOrder.shipping_status === 'pending'
    ) {
      return NextResponse.json(
        {
          error: 'Order must be processing before it can be marked as shipped.',
          code: 'ORDER_NOT_READY_TO_SHIP',
        },
        { status: 400 }
      );
    }

    if (
      shipping_status === 'shipped' &&
      !existingOrder.tracking_number &&
      !existingOrder.shipment_id &&
      isShippingProviderCode(existingOrder.shipping_provider) &&
      !existingOrder.selected_quote_id
    ) {
      return NextResponse.json(
        {
          error:
            'This provider order does not have a saved shipping quote. Please re-quote before marking it as shipped.',
          code: 'MISSING_SHIPPING_QUOTE',
        },
        { status: 400 }
      );
    }

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};

    if (payment_status !== undefined) {
      updates.payment_status = payment_status;
    }
    if (shipping_status !== undefined) {
      updates.shipping_status = shipping_status;
    }
    if (notes !== undefined) {
      updates.notes = notes;
    }
    if (shipping_address !== undefined) {
      updates.shipping_address = shipping_address;
      if (existingOrder.selected_quote_id) {
        // A shipping quote is calculated for a specific destination. Any
        // address edit invalidates that binding so a later wallet/provider
        // booking cannot charge or dispatch using stale destination pricing.
        if (shipping_status === 'shipped') {
          return NextResponse.json(
            {
              error:
                'Changing the shipping address requires a new shipping quote before shipping.',
              code: 'SHIPPING_QUOTE_INVALIDATED',
            },
            { status: 409 }
          );
        }
        // Settled checkout GIGL retention survives quote clears via DB
        // triggers, and Admin cannot rebind away from checkout once settlement
        // has retained shipping. Reject before clearing so prepaid shipping is
        // not stranded without a quote. Lock on settled retention only —
        // quote-time stamps (quiz_voucher / zero-retention) must stay editable.
        if (
          await isFundedCheckoutGiglAddressLocked(
            supabase,
            merchantId,
            id,
            existingOrder
          )
        ) {
          return NextResponse.json(
            {
              error:
                'This order already has prepaid checkout shipping. Change the address only through a settlement-safe reprice flow.',
              code: 'FUNDED_CHECKOUT_ADDRESS_LOCKED',
            },
            { status: 409 }
          );
        }
        updates.selected_quote_id = null;
        if (existingOrder.shipping_funding_source === 'merchant_wallet') {
          updates.shipping_funding_source = null;
        }
      }
    }

    const needsProviderShipmentBooking =
      shipping_status === 'shipped' &&
      !existingOrder.tracking_number &&
      !existingOrder.shipment_id &&
      isShippingProviderCode(existingOrder.shipping_provider) &&
      Boolean(existingOrder.selected_quote_id) &&
      shipping_address === undefined;

    const needsPreUpdateInventoryConfirmation =
      isPaidStatusUpdate(updates.payment_status) &&
      shipping_status !== undefined &&
      shipping_status !== existingOrder.shipping_status;

    if (needsPreUpdateInventoryConfirmation) {
      const paidStatus = updates.payment_status;
      const { error: paidUpdateError } = await supabase
        .from('orders')
        .update({ payment_status: paidStatus })
        .eq('id', id)
        .eq('merchant_id', merchantId)
        .select('id')
        .single();

      if (paidUpdateError) {
        logger.error({
          message:
            'PATCH orders/[id] failed to persist paid status before inventory confirmation',
          orderId: id,
          error: paidUpdateError,
        });
        return NextResponse.json(
          { error: 'Failed to update order' },
          { status: 500 }
        );
      }

      try {
        await ensurePaidOrderInventoryConfirmed(supabase, merchantId, id);
        inventoryConfirmedBeforeOrderUpdate = true;
        delete updates.payment_status;
      } catch (inventoryError) {
        try {
          await rollbackOrderStatusAfterInventoryConfirmationFailure(
            supabase,
            merchantId,
            id,
            {
              payment_status: existingOrder.payment_status,
              shipping_status: existingOrder.shipping_status,
            }
          );
        } catch (rollbackError) {
          logger.error({
            message:
              'PATCH orders/[id] failed to rollback paid status after pre-shipment inventory confirmation failure',
            orderId: id,
            error: rollbackError,
          });
          await fileInventoryConfirmationFailureReview({
            gatewayReference: null,
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
              source: 'merchant_paid_shipment_status_update',
            },
            orderId: id,
            reason:
              'Order status update reached paid before shipment booking, but serialized inventory confirmation and status rollback both failed.',
            transactionId: null,
          });
        }

        logger.error({
          message:
            'PATCH orders/[id] failed to confirm inventory before shipment booking',
          orderId: id,
          error: inventoryError,
        });
        const payload =
          buildInventoryConfirmationFailurePayload(inventoryError);
        return NextResponse.json(payload, {
          status:
            payload.code === 'serialized_inventory_unavailable' ? 409 : 500,
        });
      }
    }

    if (needsProviderShipmentBooking) {
      const bookingClaim = await claimOrderShipmentBooking(
        supabase,
        merchantId,
        id
      );

      if (bookingClaim.status === 'in_progress') {
        return NextResponse.json(
          {
            error: 'Shipment booking is already in progress for this order.',
            code: 'SHIPMENT_BOOKING_IN_PROGRESS',
          },
          { status: 409 }
        );
      }

      if (bookingClaim.status === 'claimed') {
        shipmentBookingLockToken = bookingClaim.lockToken;

        try {
          const booking = await runClaimedOrderWalletOrCheckoutBooking(
            supabase,
            merchantId,
            id,
            {
              selected_quote_id: existingOrder.selected_quote_id,
              shipping_funding_source: existingOrder.shipping_funding_source,
              shipping_provider: existingOrder.shipping_provider,
              payment_status: existingOrder.payment_status,
              payment_method: existingOrder.payment_method,
            },
            {
              paymentStatus: payment_status ?? existingOrder.payment_status,
              lockToken: shipmentBookingLockToken,
            }
          );
          updates.shipping_provider = booking.provider;
          updates.selected_quote_id = booking.quoteId;
          updates.shipment_id = booking.shipmentId;
          updates.tracking_number = booking.trackingNumber;
          if (shipmentBookingLockToken) {
            updates.shipment_booking_lock_token = null;
            updates.shipment_booking_started_at = null;
          }
        } catch (error) {
          if (shipmentBookingLockToken && shouldReleaseBookingLock(error)) {
            try {
              await clearOrderShipmentBookingLock(
                supabase,
                merchantId,
                id,
                shipmentBookingLockToken
              );
            } catch (lockError) {
              console.error(
                'Failed to release shipment booking lock after booking error:',
                lockError
              );
            }
          }

          throw error;
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // Update order
    let updateQuery = supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .eq('merchant_id', merchantId);

    if (shipmentBookingLockToken) {
      updateQuery = updateQuery.eq(
        'shipment_booking_lock_token',
        shipmentBookingLockToken
      );
    }

    const { data: order, error: updateError } = await updateQuery
      .select(ORDER_COLUMNS)
      .single();

    if (updateError) {
      console.error('Error updating order:', updateError);
      if (inventoryConfirmedBeforeOrderUpdate) {
        try {
          await rollbackOrderStatusAfterInventoryConfirmationFailure(
            supabase,
            merchantId,
            id,
            {
              payment_status: existingOrder.payment_status,
              shipping_status: existingOrder.shipping_status,
            }
          );
        } catch (rollbackError) {
          logger.error({
            message:
              'PATCH orders/[id] failed to rollback paid pre-update after fulfillment update failure',
            orderId: id,
            error: rollbackError,
          });
          await fileInventoryConfirmationFailureReview({
            gatewayReference: null,
            merchantId,
            metadata: {
              fulfillmentUpdateError: updateError,
              rollbackError:
                rollbackError instanceof Error
                  ? rollbackError.message
                  : rollbackError,
              source:
                'merchant_fulfillment_update_after_inventory_confirmation',
            },
            orderId: id,
            reason:
              'Inventory was confirmed after a paid pre-update, but the fulfillment update and paid-status rollback both failed.',
            transactionId: null,
          });
        }
      }
      const mappedUpdateError = mapOrderPatchUpdateError(updateError);
      if (mappedUpdateError) {
        return mappedUpdateError;
      }
      return NextResponse.json(
        { error: 'Failed to update order' },
        { status: 500 }
      );
    }

    if (
      isPaidStatusUpdate(updates.payment_status) &&
      !inventoryConfirmedBeforeOrderUpdate
    ) {
      try {
        await ensurePaidOrderInventoryConfirmed(supabase, merchantId, id);
      } catch (inventoryError) {
        try {
          await rollbackOrderStatusAfterInventoryConfirmationFailure(
            supabase,
            merchantId,
            id,
            {
              payment_status: existingOrder.payment_status,
              shipping_status: existingOrder.shipping_status,
            }
          );
        } catch (rollbackError) {
          logger.error({
            message:
              'PATCH orders/[id] failed to rollback order status after inventory confirmation failure',
            orderId: id,
            error: rollbackError,
          });
          await fileInventoryConfirmationFailureReview({
            gatewayReference: null,
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
              source: 'merchant_order_status_update',
            },
            orderId: id,
            reason:
              'Order status update reached paid state, but serialized inventory confirmation and status rollback both failed.',
            transactionId: null,
          });
        }

        logger.error({
          message: 'PATCH orders/[id] failed to confirm inventory',
          orderId: id,
          error: inventoryError,
        });
        const payload =
          buildInventoryConfirmationFailurePayload(inventoryError);
        return NextResponse.json(payload, {
          status:
            payload.code === 'serialized_inventory_unavailable' ? 409 : 500,
        });
      }
    }

    // Send push notification if shipping status changed
    if (
      shipping_status !== undefined &&
      shipping_status !== existingOrder.shipping_status &&
      existingOrder.customer_id
    ) {
      // Get customer's user_id for push notification
      const { data: customer } = await supabase
        .from('customers')
        .select('user_id')
        .eq('id', existingOrder.customer_id)
        .single();

      if (customer?.user_id) {
        runAfterResponse(() =>
          notifyOrderStatusChange(
            customer.user_id,
            id,
            existingOrder.order_number,
            shipping_status
          )
        );
      }
    }

    // On delivery, nudge the customer to activate any pending gadget cover.
    // `completed` counts as delivered too (matching maybeNotifyActivateProtection
    // and the customer policy APIs), so an API client that marks an order
    // completed still queues the one-time reminder.
    if (
      (shipping_status === 'delivered' || shipping_status === 'completed') &&
      shipping_status !== existingOrder.shipping_status
    ) {
      runAfterResponse(() => maybeNotifyActivateProtection(id));
    }

    return NextResponse.json({ order });
  } catch (error) {
    if (error instanceof OrderShipmentBookingError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          ...(error.details ?? {}),
        },
        { status: error.status }
      );
    }

    console.error('Unexpected error in PATCH /api/orders/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
