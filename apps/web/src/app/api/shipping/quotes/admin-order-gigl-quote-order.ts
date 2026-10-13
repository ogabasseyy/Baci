import { NextResponse } from 'next/server';

export const ADMIN_ORDER_GIGL_QUOTE_ORDER_SELECT =
  'id, merchant_id, customer_name, customer_phone, customer_email, shipping_address, shipping_status, shipping_provider, shipping_funding_source, selected_quote_id, shipment_id, tracking_number, order_items(id, name, quantity, price, product_id, product:products!order_items_product_id_fkey(weight_value, weight_unit, dimensions, commodity_code))';

type AdminOrderGiglQuoteOrder = {
  shipment_id?: string | null;
  shipping_status?: string | null;
  tracking_number?: string | null;
};

export function getAdminOrderGiglQuoteOrderConflict(
  order: AdminOrderGiglQuoteOrder
): NextResponse | null {
  if (
    order.shipment_id ||
    order.tracking_number ||
    ['shipped', 'booked', 'in_transit'].includes(
      String(order.shipping_status).toLowerCase()
    )
  ) {
    return NextResponse.json(
      { error: 'Order already shipped or booked' },
      { status: 409 }
    );
  }

  if (String(order.shipping_status).toLowerCase() !== 'processing') {
    return NextResponse.json(
      { error: 'Order must be processing before shipping' },
      { status: 409 }
    );
  }

  return null;
}
