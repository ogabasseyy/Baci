import { createAuthenticatedFetch } from '@/hooks/orders/authenticated-fetch';
import {
  checkoutShippingRecoveryConfirmationSchema,
  checkoutShippingRecoveryErrorSchema,
  checkoutShippingRecoverySchema,
} from '@/schemas/checkout-shipping-recovery';
import { BASE_URL } from './api-client';

export async function requestCheckoutShippingRecovery(
  orderId: string,
  body:
    | {
        action: 'preview';
        receiver: {
          address: string;
          city: string;
          state: string;
          countryCode?: string;
          phone: string;
          latitude: number;
          longitude: number;
        };
      }
    | { action: 'confirm'; previewId: string; confirmDestination: true }
) {
  const response = await createAuthenticatedFetch(
    `${BASE_URL}/api/orders/${encodeURIComponent(orderId)}/shipping/checkout-recovery`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    30_000
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    const parsed = checkoutShippingRecoveryErrorSchema.safeParse(payload);
    throw new Error(
      parsed.success
        ? parsed.data.error
        : 'Shipping recovery request failed. Please retry.'
    );
  }
  if (body.action === 'preview')
    return checkoutShippingRecoverySchema.parse(payload);
  return checkoutShippingRecoveryConfirmationSchema.parse(payload);
}
