import type { DomainEventV1 } from '@baci/shared/contracts';
import { z } from 'zod';
import { generateFbc } from '@/lib/ad-tracking-cookies';
import type { ConversionEvent } from '@/lib/analytics/send-to-ad-platforms';
import type { ServiceRoleClient } from '@/lib/supabase/service';

const orderItemSchema = z.object({
  id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  price: z.union([z.number(), z.string()]).nullable().optional(),
  product_id: z.string().nullable().optional(),
  quantity: z.union([z.number(), z.string()]).nullable().optional(),
});

const paidOrderSchema = z.object({
  ad_tracking: z.record(z.string(), z.unknown()).nullable().optional(),
  currency: z.string().nullable().optional(),
  customer_email: z.string().nullable().optional(),
  customer_id: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
  id: z.string(),
  order_items: z.array(orderItemSchema).nullable().optional(),
  order_number: z.string().nullable().optional(),
  payment_status: z.string(),
  shipping_address: z.record(z.string(), z.unknown()).nullable().optional(),
  total: z.union([z.number(), z.string()]),
});

export type PaidOrderDeliveryEvent = {
  conversion: ConversionEvent;
  gaClientId?: string;
  orderNumber: string;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function loadPaidOrderDeliveryEvent(
  supabase: ServiceRoleClient,
  event: DomainEventV1
): Promise<PaidOrderDeliveryEvent> {
  const orderId = optionalString(event.data.order_id);
  if (!orderId || !event.merchant_id || event.subject.id !== orderId) {
    throw new Error('missing_immutable_data');
  }

  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, merchant_id, order_number, payment_status, total, currency, customer_email, customer_phone, customer_name, customer_id, shipping_address, ad_tracking, order_items(id, product_id, name, price, quantity)'
    )
    .eq('id', orderId)
    .eq('merchant_id', event.merchant_id)
    .maybeSingle();
  if (error) throw new Error('paid_order_lookup_failed', { cause: error });

  const parsed = paidOrderSchema.safeParse(data);
  if (!parsed.success || parsed.data.payment_status !== 'paid') {
    throw new Error('paid_order_not_deliverable');
  }

  const order = parsed.data;
  const tracking = order.ad_tracking ?? {};
  const contents = (order.order_items ?? []).flatMap((item) => {
    const id = item.product_id ?? item.id;
    const price = Number(item.price);
    const quantity = Number(item.quantity);
    if (
      !id ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      return [];
    }
    return [{ id, name: item.name ?? id, price, quantity }];
  });
  const total = Number(order.total);
  if (!Number.isFinite(total) || total < 0)
    throw new Error('invalid_order_total');

  const eventId = event.external_event_id ?? event.domain_event_id;
  const orderNumber = order.order_number ?? order.id.slice(0, 8).toUpperCase();
  const [firstName, ...lastNameParts] =
    optionalString(order.customer_name)?.split(/\s+/) ?? [];
  const shippingAddress = order.shipping_address ?? {};
  return {
    conversion: {
      custom_data: {
        content_type: 'product',
        contents,
        currency: order.currency ?? 'NGN',
        order_id: orderNumber,
        value: total,
      },
      event_id: eventId,
      event_type: 'purchase',
      limited_data_use: tracking.limitedDataUse === true,
      merchant_id: event.merchant_id,
      occurred_at: event.occurred_at,
      source: 'server',
      user_data: {
        measurement_consent: tracking.chatgptConsent === true,
        marketing_consent: tracking.marketingConsent === true,
        analytics_consent: tracking.analyticsConsent === true,
        twclid: optionalString(tracking.twclid),
        oppref: optionalString(tracking.oppref),
        obref: optionalString(tracking.obref),
        city: optionalString(shippingAddress.city),
        country: optionalString(shippingAddress.country),
        email: order.customer_email ?? undefined,
        external_id: order.customer_id ?? undefined,
        fbc:
          optionalString(tracking.fbc) ??
          (optionalString(tracking.fbclid)
            ? generateFbc(optionalString(tracking.fbclid) as string)
            : undefined),
        fbp: optionalString(tracking.fbp),
        first_name: firstName,
        ip: optionalString(tracking.userIp),
        last_name:
          lastNameParts.length > 0 ? lastNameParts.join(' ') : undefined,
        phone: order.customer_phone ?? undefined,
        sccid: optionalString(tracking.sccid),
        state: optionalString(shippingAddress.state),
        ttclid: optionalString(tracking.ttclid),
        ttp: optionalString(tracking.ttp),
        ua: optionalString(tracking.userAgent),
        zip_code:
          optionalString(shippingAddress.zip) ??
          optionalString(shippingAddress.postal_code),
      },
    },
    gaClientId: optionalString(tracking.gaClientId),
    orderNumber,
  };
}
