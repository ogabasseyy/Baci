import { normalizeNegotiationCustomerEmail } from '@baci/shared/lib';
import {
  notifyGuestNegotiationResponseByEmail,
  notifyNegotiationResponse,
} from '@/lib/negotiation-notifications';

interface NotifyNegotiationResponseWithFallbackParams {
  acceptedPrice?: number | null;
  customerEmail?: string | null;
  customerId?: string | null;
  itemName?: string | null;
  merchantId: string;
  negotiationId: string;
  negotiationType: 'single' | 'total';
  productSlug?: string | null;
  status: 'accepted' | 'rejected' | 'countered';
}

export type NegotiationResponseNotificationResult =
  | { notified: true; channel?: 'email' }
  | { notified: false; reason: 'no_customer_email' | 'no_delivery_channel' };

export async function notifyNegotiationResponseWithFallback({
  acceptedPrice,
  customerEmail,
  customerId,
  itemName,
  merchantId,
  negotiationId,
  negotiationType,
  productSlug,
  status,
}: NotifyNegotiationResponseWithFallbackParams): Promise<NegotiationResponseNotificationResult> {
  const normalizedCustomerEmail =
    normalizeNegotiationCustomerEmail(customerEmail);

  async function notifyByEmail(email: string) {
    await notifyGuestNegotiationResponseByEmail({
      acceptedPrice,
      email,
      itemName,
      merchantId,
      negotiationId,
      negotiationType,
      productSlug,
      status,
    });
    return { notified: true, channel: 'email' } as const;
  }

  if (!customerId) {
    if (!normalizedCustomerEmail) {
      return { notified: false, reason: 'no_customer_email' };
    }

    return notifyByEmail(normalizedCustomerEmail);
  }

  try {
    const pushResult = await notifyNegotiationResponse(
      customerId,
      negotiationType,
      status,
      negotiationId,
      itemName,
      acceptedPrice,
      productSlug
    );

    if (pushResult.sent > 0) {
      return { notified: true };
    }
  } catch (error) {
    console.error(
      'Push negotiation notification failed; falling back to email',
      {
        customerId,
        error,
        merchantId,
        negotiationId,
        negotiationType,
        status,
      }
    );
  }

  if (normalizedCustomerEmail) {
    return notifyByEmail(normalizedCustomerEmail);
  }

  return { notified: false, reason: 'no_delivery_channel' };
}
