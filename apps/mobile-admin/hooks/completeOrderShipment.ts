import type { QueryClient } from '@tanstack/react-query';
import type { OrderDetailsRecord } from '@/components/orders/order-details.types';
import { BASE_URL } from '@/lib/api-client';
import {
  buildOrderFulfillmentDetailsForPersistence,
  type ShipmentCompletionMode,
  type ShipmentFulfillmentDetails,
} from '@/lib/order-shipment';
import { getNationalPhoneNumber } from '@/lib/phone-country';
import { supabase } from '@/lib/supabase';

interface ShipmentCompletionResult {
  actionLabel: string;
  actionVariant: 'default' | 'whatsapp';
  message: string;
  showAction: boolean;
  subMessage: string;
  title: string;
}

interface CompleteOrderShipmentParams {
  fulfillmentDetails: ShipmentFulfillmentDetails;
  handleSaveRider: (phone: string) => Promise<void>;
  merchantId: string;
  mode: ShipmentCompletionMode;
  order: OrderDetailsRecord;
  providerBookingAvailable: boolean;
  providerLabel: string;
  queryClient: QueryClient;
  riderPhone: string;
  saveDetails: boolean;
  updateStatus: (input: {
    orderId: string;
    status: 'shipped';
  }) => Promise<unknown>;
}

function validateDispatchPhoneForWhatsapp(phone: string) {
  const trimmedPhone = phone.trim();
  const nationalNumber = getNationalPhoneNumber(trimmedPhone);
  const digits = trimmedPhone.replace(/\D/g, '');

  if (!nationalNumber) {
    return '';
  }

  if (digits.length < 10 || digits.length > 15) {
    throw new Error('Rider phone number is not valid for WhatsApp.');
  }

  return trimmedPhone;
}

export async function completeOrderShipment({
  fulfillmentDetails,
  handleSaveRider,
  merchantId,
  mode,
  order,
  providerBookingAvailable,
  providerLabel,
  queryClient,
  riderPhone,
  saveDetails,
  updateStatus,
}: CompleteOrderShipmentParams): Promise<ShipmentCompletionResult> {
  // Rider phone is optional for self-fulfillment — the merchant can add it
  // later via the post-shipment "Send to Rider" WhatsApp action.
  const dispatchPhone =
    mode === 'self_fulfillment'
      ? validateDispatchPhoneForWhatsapp(riderPhone)
      : '';

  if (mode !== 'self_fulfillment' && !providerBookingAvailable) {
    throw new Error(
      'This order does not have a saved provider quote to book against.'
    );
  }

  if (saveDetails) {
    const { error } = await supabase
      .from('orders')
      .update({
        fulfillment_details:
          buildOrderFulfillmentDetailsForPersistence(fulfillmentDetails),
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .eq('merchant_id', merchantId);

    if (error) {
      throw error;
    }
  }

  if (mode === 'self_fulfillment') {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Unauthorized');
    }

    const response = await fetch(`${BASE_URL}/api/shipping/self-fulfill`, {
      body: JSON.stringify({
        carrierName: 'Dispatch Rider',
        dispatchNotes: `Self-fulfilled from mobile admin for order ${order.order_number}`,
        ...(dispatchPhone ? { dispatchPhone } : {}),
        orderId: order.id,
      }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      method: 'POST',
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === 'object' &&
        'error' in payload &&
        typeof payload.error === 'string'
          ? payload.error
          : 'Failed to mark order as self-fulfilled';
      throw new Error(message);
    }

    if (dispatchPhone) {
      await handleSaveRider(dispatchPhone);
    }
  } else {
    await updateStatus({ orderId: order.id, status: 'shipped' });
  }

  queryClient.invalidateQueries({ queryKey: ['order', order.id] });
  queryClient.invalidateQueries({ queryKey: ['orders'] });
  queryClient.invalidateQueries({ queryKey: ['order-counts'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
  if (mode === 'provider') {
    queryClient.invalidateQueries({ queryKey: ['merchant-wallet'] });
  }

  // Only offer the "Send Order Details to Rider" WhatsApp action when a rider
  // number was actually provided — otherwise the action would dead-end.
  const canSendToRider = mode === 'self_fulfillment' && Boolean(dispatchPhone);

  return {
    actionLabel: canSendToRider ? 'Send Order Details to Rider' : '',
    actionVariant: canSendToRider ? 'whatsapp' : 'default',
    message:
      mode === 'self_fulfillment'
        ? 'The order has been marked shipped. Customer notification has been queued.'
        : providerLabel
          ? `The order has been booked with ${providerLabel} and marked shipped.`
          : 'The order has been marked shipped.',
    showAction: canSendToRider,
    subMessage: canSendToRider
      ? 'You can now send the delivery details to your dispatch rider on WhatsApp.'
      : mode === 'self_fulfillment'
        ? 'Add a rider number on the order anytime to send delivery details on WhatsApp.'
        : 'The customer notification has been queued and will not block fulfillment.',
    title: mode === 'self_fulfillment' ? 'Order Shipped' : 'Shipment Booked',
  };
}
