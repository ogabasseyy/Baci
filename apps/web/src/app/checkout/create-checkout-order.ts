import { getAdTrackingData } from '@/lib/ad-tracking-cookies';
import { apiPost } from '@/lib/api-client';
import type { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import type { ShippingQuote } from '@/types/shipping-quote';
import { buildCheckoutShippingSelectionPayload } from './checkout-order-shipping-payload';

interface CreateCheckoutOrderInput {
  merchantId: string;
  data: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
  };
  orderItems: ReturnType<typeof buildCheckoutOrderItems>;
  subtotal: number;
  finalShippingFee: number;
  selectedGateway: 'paystack' | 'korapay' | 'pod' | 'credit_direct';
  selectedShippingQuote: ShippingQuote;
  shippingSessionId: string;
  discountCode?: string | null;
  idempotencyKey?: string | null;
}

interface CheckoutOrderResponse {
  order: Record<string, unknown>;
  paystackAuthUrl?: string;
}

// Create the order server-side. Kept at module scope so the order-submit
// handler stays free of the try/throw control flow the compiler can't lower.
export function createCheckoutOrder(
  input: CreateCheckoutOrderInput
): Promise<CheckoutOrderResponse> {
  return apiPost<CheckoutOrderResponse>(
    '/api/orders',
    {
      merchant_id: input.merchantId,
      customer_email: input.data.email,
      customer_name: `${input.data.firstName} ${input.data.lastName}`,
      customer_phone: input.data.phone,
      items: input.orderItems,
      subtotal: input.subtotal,
      shipping_fee: input.finalShippingFee,
      payment_method: input.selectedGateway,
      payment_status: 'unpaid', // Order starts unpaid, changes to pending when payment initiated, then paid on confirmation
      shipping_status: 'pending',
      shipping_address: {
        firstName: input.data.firstName,
        lastName: input.data.lastName,
        address: input.data.address,
        city: input.data.city,
        state: input.data.state,
      },
      source: 'online_store',
      ad_tracking: getAdTrackingData(),
      // The submit guard guarantees a selected quote. Carrier quotes reference
      // their persisted quote row; merchant rates send their bare configured
      // rate id and intentionally null the carrier fields.
      ...buildCheckoutShippingSelectionPayload(
        input.selectedShippingQuote,
        input.shippingSessionId
      ),
      // Only the trusted code string is sent; the route recomputes + validates
      // the amount server-side. No expected_total here (this legacy flow has no
      // VAT-aware total object), so the wrapper's two-sided amount check guards.
      ...(input.discountCode ? { discount_code: input.discountCode } : {}),
    },
    // Code-bearing checkouts carry the persisted idempotency key so a
    // response lost after commit replays the original order instead of
    // failing against the now-claimed single-use code.
    {
      ...(input.idempotencyKey
        ? { headers: { 'Idempotency-Key': input.idempotencyKey } }
        : {}),
    }
  );
}
