import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import {
  handlePaymentForCancelledOrder,
  isOrderClampedAsCancelled,
} from '@/lib/payments/handle-payment-for-cancelled-order';
import { shipOnCreditBodySchema } from '@/schemas/ship-on-credit-schema';
import { provisionCreditOrderDva } from './provision-credit-order-dva';

/**
 * POST /api/orders/[id]/ship-on-credit
 * Allows merchants to ship orders on credit (unpaid) with notes.
 * Optionally creates a virtual account for payment collection.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Auth check (supports mobile Bearer token + web cookies)
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // CSRF protection
    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const { id: orderId } = await params;
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const bodyResult = shipOnCreditBodySchema.safeParse(rawBody);
    if (!bodyResult.success) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }
    const body = bodyResult.data;

    // 2. Get merchant ID (supports both owners and staff members)
    const merchantId = await getMerchantIdForApiUser(auth.supabase);
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const supabase = auth.supabase;

    // 3. Get merchant details for virtual account
    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .select('id, business_name')
      .eq('id', merchantId)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json(
        { error: 'Merchant details not found' },
        { status: 404 }
      );
    }

    // 3. Get order and verify ownership
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(
        'id, order_number, total, customer_name, customer_email, payment_status, shipping_status, cancelled_at, payment_due_date'
      )
      .eq('id', orderId)
      .eq('merchant_id', merchantId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // 4. Validate order is not already paid
    if (order.payment_status === 'paid') {
      return NextResponse.json(
        { error: 'Order is already paid. No need for credit shipping.' },
        { status: 400 }
      );
    }

    // 5. Extract credit notes from the validated body.
    const creditNotes = body.credit_notes || body.notes || '';

    // 6. Update order to mark as credit and move to processing
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        is_credit_order: true,
        credit_notes: creditNotes,
        shipping_status: 'processing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .eq('merchant_id', merchantId)
      .is('cancelled_at', null)
      .neq('shipping_status', 'cancelled')
      .select('id, shipping_status, cancelled_at')
      .maybeSingle();

    if (updateError) {
      logger.error({
        message: 'Failed to update order for credit shipping',
        error: updateError,
      });
      return NextResponse.json(
        { error: 'Failed to update order' },
        { status: 500 }
      );
    }

    if (!updatedOrder) {
      const { data: currentOrder, error: currentOrderError } = await supabase
        .from('orders')
        .select('id, shipping_status, cancelled_at')
        .eq('id', orderId)
        .eq('merchant_id', merchantId)
        .maybeSingle();

      if (currentOrderError) {
        logger.error({
          message:
            'Database error checking order after credit shipping update matched no rows',
          error: currentOrderError,
          orderId,
        });
        return NextResponse.json(
          { error: 'Failed to verify order status' },
          { status: 500 }
        );
      }

      if (isOrderClampedAsCancelled(currentOrder)) {
        await handlePaymentForCancelledOrder({
          gatewayReference: null,
          order: currentOrder ?? { id: orderId },
          reason:
            'Ship-on-credit attempted on an order cancelled by the customer',
          transactionId: null,
        });

        return NextResponse.json(
          {
            error: 'Order was cancelled and cannot be shipped on credit',
            code: 'ORDER_CANCELLED',
          },
          { status: 409 }
        );
      }

      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Reject a customer-cancelled order clamped by the database trigger.
    if (isOrderClampedAsCancelled(updatedOrder)) {
      await handlePaymentForCancelledOrder({
        gatewayReference: null,
        order: updatedOrder ?? { id: orderId },
        reason:
          'Ship-on-credit attempted on an order cancelled by the customer',
        transactionId: null,
      });

      return NextResponse.json(
        {
          error: 'Order was cancelled and cannot be shipped on credit',
          code: 'ORDER_CANCELLED',
        },
        { status: 409 }
      );
    }

    let virtualAccount = null;
    virtualAccount = await provisionCreditOrderDva({
      customerEmail: order.customer_email,
      customerName: order.customer_name,
      orderId,
      paymentDueDate: order.payment_due_date,
      supabase,
    });

    return NextResponse.json({
      success: true,
      message: 'Order confirmed for credit shipping',
      order: {
        id: orderId,
        order_number: order.order_number,
        shipping_status: 'processing',
        is_credit_order: true,
      },
      virtualAccount,
    });
  } catch (error) {
    logger.error({ message: 'Ship on credit API error', error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
