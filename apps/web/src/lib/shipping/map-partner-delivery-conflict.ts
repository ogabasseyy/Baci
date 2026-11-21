import { NextResponse } from 'next/server';

export function mapPartnerDeliveryConflict(message: string | undefined) {
  const conflicts = {
    partner_delivery_destination_changed: {
      code: 'PARTNER_DELIVERY_DESTINATION_CHANGED',
      error: 'Use the destination on the paid partner quote.',
    },
    partner_delivery_origin_or_parcel_changed: {
      code: 'PARTNER_DELIVERY_ORIGIN_OR_PARCEL_CHANGED',
      error: 'The pickup origin or parcel differs from the paid partner quote.',
    },
    partner_order_source_immutable: {
      code: 'PARTNER_ORDER_SOURCE_IMMUTABLE',
      error: 'The source of the accepted partner order is fixed.',
    },
    partner_shipping_requires_merchant_wallet: {
      code: 'PARTNER_SHIPPING_REQUIRES_MERCHANT_WALLET',
      error:
        'Bind a merchant-wallet GIG quote before dispatching the partner order.',
    },
    partner_shipping_quote_invalid: {
      code: 'PARTNER_SHIPPING_QUOTE_INVALID',
      error: 'Get a new GIG quote for this partner order before booking.',
    },
    partner_delivery_price_changed: {
      code: 'PARTNER_DELIVERY_PRICE_CHANGED',
      error:
        'The current GIG rate differs from the settled delivery fee. Resolve the difference before booking.',
    },
    partner_settled_order_amounts_immutable: {
      code: 'PARTNER_SETTLED_ORDER_AMOUNTS_IMMUTABLE',
      error:
        'The settled partner order amounts must be preserved. Review the settlement before booking.',
    },
    partner_delivery_service_changed: {
      code: 'PARTNER_DELIVERY_SERVICE_CHANGED',
      error:
        'The current GIG service differs from the settled delivery quote. Review the service before booking.',
    },
  };
  // Normalize the first line from PostgreSQL wrappers. Detail and context
  // lines can contain unrelated text and cannot select a conflict response.
  const reason = message
    ?.split(/\r?\n/, 1)[0]
    ?.trim()
    .replace(/^(?:ERROR: *)+/, '');
  if (!reason || !Object.hasOwn(conflicts, reason)) return null;
  return NextResponse.json(conflicts[reason as keyof typeof conflicts], {
    status: 409,
  });
}
