import type { CreateOrderRequest } from './orders.schemas';
import { getInitialPaymentStatus } from './payment-status';

interface BuildOrderPayloadInput {
  merchantId: string;
  request: CreateOrderRequest;
  userId?: string;
}

export function buildOrderPayload({
  merchantId,
  request,
  userId,
}: BuildOrderPayloadInput) {
  return {
    merchant_id: merchantId,
    customer_email: request.customer_email,
    customer_name: request.customer_name,
    customer_phone: request.customer_phone,
    items: request.items.map((item) => ({
      id: item.id,
      condition: item.condition,
      product_id: item.product_id || item.id,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      image_url: item.image_url,
      value: Math.round(item.price * item.quantity),
      variant_id: item.variant_id,
      variant_name: item.variant_name,
      variant_attributes: item.variant_attributes || {},
      has_assurance: item.has_assurance ?? false,
      assurance_fee: item.assurance_fee ?? 0,
      voucher_award_id: item.voucher_award_id,
      voucher_token: item.voucher_token,
    })),
    subtotal: request.subtotal,
    shipping_fee: request.shipping_fee,
    tax_amount: request.tax_amount ?? 0,
    expected_total: request.expected_total,
    client_total: request.client_total,
    // Raw client discount_amount is never trusted by /api/orders (rejected if
    // non-zero). Only the code is sent; the route recomputes the amount.
    discount_amount: 0,
    ...(request.discount_code ? { discount_code: request.discount_code } : {}),
    payment_method: request.payment_method,
    selected_quote_id: request.selected_quote_id ?? null,
    shipping_rate_id: request.shipping_rate_id ?? null,
    shipping_provider: request.shipping_provider ?? null,
    delivery_method: request.delivery_method,
    airport_type: request.airport_type,
    payment_status: getInitialPaymentStatus(request.payment_method),
    shipping_status: 'pending',
    shipping_address: {
      firstName: request.shipping_address.firstName,
      lastName: request.shipping_address.lastName,
      address: request.shipping_address.address,
      city: request.shipping_address.city,
      state: request.shipping_address.state,
      notes: request.shipping_address.notes || '',
    },
    source: 'mobile_app',
    ...(userId && { user_id: userId }),
    ...(request.use_wallet_credit === true &&
      typeof request.wallet_amount === 'number' &&
      request.wallet_amount > 0 && {
        use_wallet_credit: request.use_wallet_credit,
        wallet_amount: request.wallet_amount,
      }),
    ...(request.use_savings_credit === true &&
      typeof request.savings_goal_id === 'string' &&
      typeof request.savings_amount === 'number' &&
      request.savings_amount > 0 && {
        savings_amount: request.savings_amount,
        savings_goal_id: request.savings_goal_id,
        use_savings_credit: request.use_savings_credit,
      }),
  };
}
