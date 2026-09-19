import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getOrderNumberLookupCandidates } from '@/lib/order-number-lookup';
import { createAnonClient } from '@/lib/supabase/anon';
import {
  trackOrderEmailSchema,
  trackOrderTokenSchema,
} from '@/schemas/track-order';

// Unauthenticated order tracking endpoint.
// The get_order_tracking RPC is SECURITY DEFINER (bypasses table-level RLS).
// Access control is enforced by the function's internal WHERE clauses:
// - Token-based lookup: requires only possession of a valid tracking token
// - Email-based lookup: requires matching email + order_id/order_number
// PII (email, phone) is masked by the API route before returning to the client.

interface TimelineEvent {
  status: string;
  title: string;
  description: string;
  timestamp: string;
  icon:
    | 'order'
    | 'payment'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'returned';
}

interface ShippingAddress {
  address?: string;
  city?: string;
  state?: string;
}

interface OrderItemRow {
  id: string;
  product_id: string;
  condition?: string | null;
  image_url?: string | null;
  name: string;
  variant_name?: string | null;
  quantity: number;
  price: number;
  product_images?: unknown;
}

interface TrackedOrder {
  id: string;
  order_number: string;
  shipping_status: string;
  payment_status: string;
  subtotal: number;
  shipping_cost: number;
  discount_amount: number | null;
  tax_amount?: number | null;
  gift_wrapping_fee?: number | null;
  total: number;
  currency?: string | null;
  created_at: string;
  updated_at: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  shipping_address: ShippingAddress | string | null;
  tracking_number?: string | null;
  shipping_provider?: string | null;
  paid_at?: string;
  shipped_at?: string;
  delivered_at?: string;
  cancelled_at?: string;
  merchant_business_name?: string | null;
  merchant_logo_url?: string | null;
  merchant_support_email?: string | null;
  merchant_support_phone?: string | null;
  merchant_phone?: string | null;
  items?: OrderItemRow[] | null;
  shipping_state?: string;
}

function getCustomerOrderStatusKey(status: string): string {
  switch (status) {
    case 'shipped':
    case 'out_for_delivery':
      return 'shipped';
    case 'delivered':
      return 'delivered';
    case 'cancelled':
    case 'refunded':
      return 'cancelled';
    case 'returned':
      return 'returned';
    default:
      return 'placed';
  }
}

// Type-guard helper to safely extract first image URL from unknown product_images
function extractFirstImageUrl(productImages: unknown): string | null {
  if (!Array.isArray(productImages) || productImages.length === 0) {
    return null;
  }

  const first = productImages[0];

  // Handle string URL
  if (typeof first === 'string') {
    return first;
  }

  // Handle object with url property
  if (
    first &&
    typeof first === 'object' &&
    'url' in first &&
    typeof first.url === 'string'
  ) {
    return first.url;
  }

  return null;
}

// GET - Track order by tracking token, or by order number/ID + email
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const trackingToken = searchParams.get('token');
    const orderNumber = searchParams.get('order_number');
    const orderId = searchParams.get('order_id');
    const email = searchParams.get('email');
    const merchantSlug =
      searchParams.get('merchant_slug') || searchParams.get('slug');

    // Validate input based on mode
    let validatedMerchantSlug: string;
    let validatedToken: string | null = null;
    let validatedOrderId: string | null = null;
    let validatedOrderNumber: string | null = null;
    let validatedEmail: string | null = null;

    if (trackingToken) {
      const parsed = trackOrderTokenSchema.safeParse({
        token: trackingToken ?? undefined,
        merchant_slug: merchantSlug ?? undefined,
      });
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: 'Invalid input',
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }
      validatedMerchantSlug = parsed.data.merchant_slug;
      validatedToken = parsed.data.token;
    } else {
      const parsed = trackOrderEmailSchema.safeParse({
        order_number: orderNumber ?? undefined,
        order_id: orderId ?? undefined,
        email: email ?? undefined,
        merchant_slug: merchantSlug ?? undefined,
      });
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: 'Invalid input',
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }
      validatedMerchantSlug = parsed.data.merchant_slug;
      validatedOrderId = parsed.data.order_id ?? null;
      validatedOrderNumber = parsed.data.order_number ?? null;
      validatedEmail = parsed.data.email;
    }

    const supabase = createAnonClient();

    const orderNumberCandidates =
      validatedToken || validatedOrderId || !validatedOrderNumber
        ? [validatedOrderNumber]
        : getOrderNumberLookupCandidates(validatedOrderNumber);

    let error: { code?: string } | null = null;
    let order: TrackedOrder | null = null;

    for (const candidateOrderNumber of orderNumberCandidates) {
      const result = await supabase.rpc('get_order_tracking', {
        p_merchant_slug: validatedMerchantSlug,
        p_order_id: validatedOrderId,
        p_order_number: candidateOrderNumber || null,
        p_email: validatedEmail,
        p_tracking_token: validatedToken,
      });

      if (result.error) {
        error = result.error;
        break;
      }

      const matchedOrder = Array.isArray(result.data)
        ? (result.data[0] as TrackedOrder | undefined)
        : null;

      if (matchedOrder) {
        order = matchedOrder;
        break;
      }
    }

    if (error || !order) {
      logger.error({
        message: 'Track order error',
        code: error?.code ?? 'NOT_FOUND',
      });
      return NextResponse.json(
        { error: 'Order not found. Please check your order number and email.' },
        { status: 404 }
      );
    }

    // Generate timeline events based on order status
    const timeline = generateTimeline(order);

    // Get shipping tracking if available
    let shippingTracking = null;
    if (order.tracking_number && order.shipping_provider) {
      shippingTracking = {
        provider: order.shipping_provider,
        tracking_number: order.tracking_number,
        tracking_url: getTrackingUrl(
          order.shipping_provider,
          order.tracking_number
        ),
      };
    }

    // Calculate estimated delivery
    const estimatedDelivery = calculateEstimatedDelivery(order);

    const shippingAddress = order.shipping_address as unknown as
      | ShippingAddress
      | string;

    // PII masking policy: token-based lookups return full PII (secret bearer token),
    // email-based lookups return masked data to limit exposure.
    const shouldMaskPii = !validatedToken;

    return NextResponse.json({
      order: {
        id: order.id,
        order_number: order.order_number,
        status: order.shipping_status,
        payment_status: order.payment_status,
        created_at: order.created_at,
        updated_at: order.updated_at,
        subtotal: order.subtotal,
        shipping_cost: order.shipping_cost,
        discount_amount: order.discount_amount,
        tax_amount: order.tax_amount ?? null,
        gift_wrapping_fee: order.gift_wrapping_fee ?? null,
        total: order.total,
        currency: order.currency || 'NGN',
      },
      customer: {
        name: order.customer_name,
        email: shouldMaskPii
          ? maskEmail(order.customer_email)
          : order.customer_email,
        phone: shouldMaskPii
          ? maskPhone(order.customer_phone)
          : order.customer_phone,
      },
      shipping_address: {
        address:
          typeof shippingAddress === 'object'
            ? shippingAddress.address
            : shippingAddress,
        city: typeof shippingAddress === 'object' ? shippingAddress.city : '',
        state: typeof shippingAddress === 'object' ? shippingAddress.state : '',
        country: 'Nigeria', // Simplified as it's typically Nigeria for this platform
      },
      items: (Array.isArray(order.items) ? order.items : []).map(
        (item: OrderItemRow) => ({
          id: item.id,
          product_id: item.product_id,
          product_name: item.name,
          condition: item.condition || null,
          variant_name: item.variant_name,
          quantity: item.quantity,
          unit_price: item.price,
          total_price: item.price * item.quantity,
          product_image:
            item.image_url || extractFirstImageUrl(item.product_images),
        })
      ),
      timeline,
      shipping_tracking: shippingTracking,
      estimated_delivery: estimatedDelivery,
      merchant: {
        name: order.merchant_business_name,
        logo: order.merchant_logo_url,
        support_email: order.merchant_support_email,
        support_phone: order.merchant_support_phone || order.merchant_phone,
      },
    });
  } catch (error) {
    logger.error({ message: 'Error tracking order', error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function generateTimeline(order: {
  shipping_status: string;
  payment_status: string;
  created_at: string;
  updated_at: string;
  paid_at?: string;
  shipped_at?: string;
  delivered_at?: string;
  cancelled_at?: string;
}): TimelineEvent[] {
  const timeline: TimelineEvent[] = [];
  const rawStatus = order.shipping_status;
  const status = getCustomerOrderStatusKey(rawStatus);

  // Order placed
  timeline.push({
    status: 'completed',
    title: 'Order Placed',
    description: 'Your order has been received',
    timestamp: order.created_at,
    icon: 'order',
  });

  // Payment
  if (order.payment_status === 'paid') {
    timeline.push({
      status: 'completed',
      title: 'Payment Confirmed',
      description: 'Payment has been successfully processed',
      timestamp: order.paid_at || order.created_at,
      icon: 'payment',
    });
  } else if (order.payment_status === 'pending') {
    timeline.push({
      status: 'current',
      title: 'Awaiting Payment',
      description: 'We are waiting for payment confirmation',
      timestamp: order.created_at,
      icon: 'payment',
    });
  } else if (order.payment_status === 'failed') {
    timeline.push({
      status: 'failed',
      title: 'Payment Failed',
      description: 'There was an issue with your payment',
      timestamp: order.created_at,
      icon: 'payment',
    });
  }

  if (status === 'cancelled') {
    timeline.push({
      status: 'failed',
      title: 'Cancelled',
      description: 'This order has been cancelled',
      timestamp: order.cancelled_at || order.updated_at || order.created_at,
      icon: 'cancelled',
    });

    return timeline;
  }

  if (['shipped', 'delivered', 'returned'].includes(status)) {
    timeline.push({
      status: status === 'shipped' ? 'current' : 'completed',
      title: 'On the way',
      description: 'Your order has left the merchant and is on the way to you',
      timestamp: order.shipped_at || '',
      icon: 'shipped',
    });
  } else if (order.payment_status === 'paid') {
    timeline.push({
      status: 'pending',
      title: 'On the way',
      description: 'Tracking will appear once the merchant ships your order',
      timestamp: '',
      icon: 'shipped',
    });
  }

  if (status === 'delivered') {
    timeline.push({
      status: 'completed',
      title: 'Delivered',
      description: 'Your order has been delivered',
      timestamp: order.delivered_at || '',
      icon: 'delivered',
    });
  } else if (status === 'shipped') {
    timeline.push({
      status: 'pending',
      title: 'Delivered',
      description: 'Awaiting delivery',
      timestamp: '',
      icon: 'delivered',
    });
  }

  if (status === 'returned') {
    timeline.push({
      status: 'current',
      title: 'Returned',
      description: 'This order was returned after delivery',
      timestamp: order.updated_at || order.delivered_at || order.created_at,
      icon: 'returned',
    });
  }

  return timeline;
}

function getTrackingUrl(provider: string, trackingNumber: string): string {
  const encodedTracking = encodeURIComponent(trackingNumber);
  const providers: Record<string, string> = {
    gigl: `https://giglogistics.com/track/${encodedTracking}`,
    topship: `https://topship.africa/track/${encodedTracking}`,

    dhl: `https://www.dhl.com/en/express/tracking.html?AWB=${encodedTracking}`,
    fedex: `https://www.fedex.com/fedextrack/?trknbr=${encodedTracking}`,
    ups: `https://www.ups.com/track?tracknum=${encodedTracking}`,
  };

  return providers[provider.toLowerCase()] || '#';
}

function calculateEstimatedDelivery(order: {
  shipping_status: string;
  created_at: string;
  shipping_state?: string;
}): { min: string; max: string } | null {
  if (['delivered', 'cancelled'].includes(order.shipping_status)) {
    return null;
  }

  const orderDate = new Date(order.created_at);

  // Estimate based on location (Nigerian logistics)
  const isLagos = order.shipping_state?.toLowerCase().includes('lagos');
  const minDays = isLagos ? 1 : 3;
  const maxDays = isLagos ? 3 : 7;

  const minDate = new Date(orderDate);
  minDate.setDate(minDate.getDate() + minDays);

  const maxDate = new Date(orderDate);
  maxDate.setDate(maxDate.getDate() + maxDays);

  return {
    min: minDate.toISOString(),
    max: maxDate.toISOString(),
  };
}

function maskEmail(email: string): string {
  if (!email?.includes('@')) return '***';
  const [local, domain] = email.split('@');
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone?: string): string {
  if (!phone) return '';
  if (phone.length <= 4) return '****';
  return `${phone.slice(0, 4)}****${phone.slice(-2)}`;
}
