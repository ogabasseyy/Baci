import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { getOrderNumberLookupCandidates } from '@/lib/order-number-lookup';
import type { CancelOrderParams } from './chat-tools';

const CANCELLABLE_PAYMENT_STATUSES = ['pending', 'unpaid'];
const CANCELLABLE_SHIPPING_STATUSES = ['pending'];

type ChatOrderCancellationSupabaseClient = Pick<SupabaseClient, 'from'>;

interface CancelOrderResult {
  success: boolean;
  status: 'cancelled' | 'already_cancelled' | 'not_cancellable' | 'not_found';
  orderId?: string;
  orderNumber?: string | null;
  paymentStatus?: string | null;
  shippingStatus?: string | null;
  message: string;
}

interface CancelOrderRow {
  id: string;
  order_number: string | null;
  customer_email: string | null;
  payment_status: string | null;
  shipping_status: string | null;
}

interface CancelledOrderRow {
  id: string;
  order_number: string | null;
  payment_status: string | null;
  shipping_status: string | null;
}

function createChatOrderCancellationSupabaseClient({
  merchantId,
  merchantSlug,
}: {
  merchantId: string;
  merchantSlug: string;
}): ChatOrderCancellationSupabaseClient {
  return createAgenticScopedSupabaseClient({
    merchantId,
    merchantSlug,
  });
}

function normalizeEmail(value: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

function isAlreadyCancelled(order: CancelOrderRow): boolean {
  return (
    order.payment_status === 'cancelled' ||
    order.shipping_status === 'cancelled'
  );
}

function isCancellableOrder(order: CancelOrderRow): boolean {
  return (
    CANCELLABLE_PAYMENT_STATUSES.includes(order.payment_status ?? '') &&
    CANCELLABLE_SHIPPING_STATUSES.includes(order.shipping_status ?? '')
  );
}

function createCancelOrderNotFoundResult(): CancelOrderResult {
  return {
    success: false,
    status: 'not_found',
    message:
      'I could not find an order matching that order reference and email.',
  };
}

export async function handleCancelOrder(
  params: CancelOrderParams
): Promise<CancelOrderResult> {
  const customerEmail = normalizeEmail(params.customerEmail);

  try {
    const tenant = await resolveAgenticChatTenant();
    if (!tenant?.agenticCheckoutEnabled) {
      return createCancelOrderNotFoundResult();
    }

    const { merchantId, merchantSlug } = tenant;
    const supabase = createChatOrderCancellationSupabaseClient({
      merchantId,
      merchantSlug,
    });
    let query = supabase
      .from('orders')
      .select(
        'id, order_number, customer_email, payment_status, shipping_status'
      )
      .eq('merchant_id', merchantId);

    if (params.orderId) {
      query = query.eq('id', params.orderId);
    }

    if (params.orderNumber) {
      const orderNumberCandidates = getOrderNumberLookupCandidates(
        params.orderNumber
      );
      if (orderNumberCandidates.length === 0) {
        return createCancelOrderNotFoundResult();
      }
      query = query.in('order_number', orderNumberCandidates);
    }

    const { data, error } = await query.limit(5);

    if (error) {
      console.error('[Chat Tools] Cancel order lookup error:', error);
      return createCancelOrderNotFoundResult();
    }

    const order = ((data || []) as CancelOrderRow[]).find(
      (candidate) => normalizeEmail(candidate.customer_email) === customerEmail
    );

    if (!order) {
      return createCancelOrderNotFoundResult();
    }

    if (isAlreadyCancelled(order)) {
      return {
        success: true,
        status: 'already_cancelled',
        orderId: order.id,
        orderNumber: order.order_number,
        paymentStatus: order.payment_status,
        shippingStatus: order.shipping_status,
        message: 'This order is already cancelled.',
      };
    }

    if (!isCancellableOrder(order)) {
      return {
        success: false,
        status: 'not_cancellable',
        orderId: order.id,
        orderNumber: order.order_number,
        paymentStatus: order.payment_status,
        shippingStatus: order.shipping_status,
        message:
          'I can only cancel orders that are unpaid and not yet being fulfilled. Please contact WhatsApp support for this order.',
      };
    }

    const { data: cancelledOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        payment_status: 'cancelled',
        shipping_status: 'cancelled',
      })
      .eq('id', order.id)
      .eq('merchant_id', merchantId)
      .eq('customer_email', order.customer_email ?? '')
      .in('payment_status', CANCELLABLE_PAYMENT_STATUSES)
      .in('shipping_status', CANCELLABLE_SHIPPING_STATUSES)
      .select('id, order_number, payment_status, shipping_status')
      .maybeSingle();

    if (updateError) {
      console.error('[Chat Tools] Cancel order update error:', updateError);
      return {
        success: false,
        status: 'not_cancellable',
        orderId: order.id,
        orderNumber: order.order_number,
        paymentStatus: order.payment_status,
        shippingStatus: order.shipping_status,
        message:
          'I could not cancel this order automatically. Please contact WhatsApp support.',
      };
    }

    if (!cancelledOrder) {
      return {
        success: false,
        status: 'not_cancellable',
        orderId: order.id,
        orderNumber: order.order_number,
        paymentStatus: order.payment_status,
        shippingStatus: order.shipping_status,
        message:
          'This order changed status before I could cancel it. Please contact WhatsApp support.',
      };
    }

    const updatedOrder = cancelledOrder as CancelledOrderRow;

    return {
      success: true,
      status: 'cancelled',
      orderId: updatedOrder.id,
      orderNumber: updatedOrder.order_number,
      paymentStatus: updatedOrder.payment_status,
      shippingStatus: updatedOrder.shipping_status,
      message: 'The order has been cancelled.',
    };
  } catch (err) {
    console.error('[Chat Tools] Cancel order error:', err);
    return {
      success: false,
      status: 'not_found',
      message:
        'I could not cancel that order right now. Please contact WhatsApp support.',
    };
  }
}
