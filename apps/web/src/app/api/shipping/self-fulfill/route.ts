import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  SelfFulfillmentSchema,
  SelfFulfillmentUpdateSchema,
} from '@/schemas/shipping';
import { mapSelfFulfillRpcError } from './map-self-fulfill-rpc-error';

async function notifySelfFulfillmentStatusChange(
  customerUserId: string,
  orderId: string,
  orderNumber: string
) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      '[self-fulfill] Skipping push notification because SUPABASE_SERVICE_ROLE_KEY is not configured'
    );
    return;
  }

  try {
    const { notifyOrderStatusChange } = await import('@/lib/expo-push');
    await notifyOrderStatusChange(
      customerUserId,
      orderId,
      orderNumber,
      'shipped'
    );
  } catch (error) {
    console.error(
      'Failed to send self-fulfillment order status push notification:',
      error
    );
  }
}

// POST /api/shipping/self-fulfill - Mark order as self-fulfilled

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const merchantId = await getMerchantIdForApiUser(auth.supabase);
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const supabase = auth.supabase;
    const user = auth.user;

    const body = await request.json();

    const parseResult = SelfFulfillmentSchema.safeParse(body);
    if (!parseResult.success) {
      const details = parseResult.error.flatten();
      return NextResponse.json(
        {
          error: 'Invalid request',
          details,
        },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(
        'id, merchant_id, order_number, shipping_status, customer_id, customer_name, customer_phone, shipping_address'
      )
      .eq('id', data.orderId)
      .eq('merchant_id', merchantId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (
      order.shipping_status === 'shipped' ||
      order.shipping_status === 'delivered'
    ) {
      return NextResponse.json(
        { error: 'Order has already been shipped' },
        { status: 400 }
      );
    }

    const selfFulfillmentData = {
      trackingNumber: data.trackingNumber || null,
      dispatchPhone: data.dispatchPhone ?? null,
      carrierName: data.carrierName || 'Self-Delivery',
      dispatchNotes: data.dispatchNotes,
      fulfilledAt: new Date().toISOString(),
      fulfilledBy: user.id,
    };

    const { error: fulfillError } = await supabase.rpc(
      'self_fulfill_order_with_wallet_release',
      {
        p_order_id: data.orderId,
        p_self_fulfillment_data: selfFulfillmentData,
        p_carrier_name: data.carrierName || 'Self-Delivery',
        p_tracking_number: data.trackingNumber ?? null,
      }
    );
    if (fulfillError) {
      console.error('Error self-fulfilling order:', fulfillError);
      const mapped = mapSelfFulfillRpcError(fulfillError);
      return NextResponse.json(
        {
          error: mapped.error,
          ...(mapped.code ? { code: mapped.code } : {}),
        },
        { status: mapped.status }
      );
    }

    if (order.customer_id) {
      const { data: customer, error: customerLookupError } = await supabase
        .from('customers')
        .select('user_id')
        .eq('id', order.customer_id)
        .maybeSingle();

      if (customerLookupError) {
        console.error(
          'Error loading self-fulfillment customer user:',
          customerLookupError
        );
      }

      if (customer?.user_id) {
        void notifySelfFulfillmentStatusChange(
          customer.user_id,
          data.orderId,
          order.order_number ?? data.orderId
        );
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Order marked as self-fulfilled',
        fulfillment: {
          orderId: data.orderId,
          trackingNumber: data.trackingNumber,
          dispatchPhone: data.dispatchPhone ?? null,
          carrierName: data.carrierName || 'Self-Delivery',
          customer: {
            name: order.customer_name,
            phone: order.customer_phone,
            address: order.shipping_address,
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error processing self-fulfillment:', error);
    return NextResponse.json(
      { error: 'Failed to process self-fulfillment' },
      { status: 500 }
    );
  }
}

// PATCH /api/shipping/self-fulfill - Update self-fulfillment details

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const merchantId = await getMerchantIdForApiUser(auth.supabase);
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const supabase = auth.supabase;

    const body = await request.json();
    const parseResult = SelfFulfillmentUpdateSchema.safeParse(body);

    if (!parseResult.success) {
      const details = parseResult.error.flatten();
      return NextResponse.json(
        {
          error: 'Invalid request',
          details,
        },
        { status: 400 }
      );
    }

    const { orderId, ...updates } = parseResult.data;

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, merchant_id, fulfillment_type, self_fulfillment_data')
      .eq('id', orderId)
      .eq('merchant_id', merchantId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.fulfillment_type !== 'self') {
      return NextResponse.json(
        { error: 'Order is not self-fulfilled' },
        { status: 400 }
      );
    }

    const updatedData = {
      ...order.self_fulfillment_data,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from('orders')
      .update({
        self_fulfillment_data: updatedData,
        tracking_number:
          updates.trackingNumber || order.self_fulfillment_data?.trackingNumber,
      })
      .eq('id', orderId)
      .eq('merchant_id', merchantId);

    if (updateError) {
      console.error('Error updating self-fulfillment:', updateError);
      return NextResponse.json(
        { error: 'Failed to update order' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Self-fulfillment details updated',
      fulfillment: updatedData,
    });
  } catch (error) {
    console.error('Error updating self-fulfillment:', error);
    return NextResponse.json(
      { error: 'Failed to update self-fulfillment' },
      { status: 500 }
    );
  }
}
