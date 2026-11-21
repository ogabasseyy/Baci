import 'server-only';

import { createHmac } from 'node:crypto';
import { z } from 'zod';

const settings = z.object({
  userId: z.uuid(),
  orderId: z.uuid(),
  presentationKey: z.string().min(32),
});

export const PILOT_PRODUCT_ID = '2844';
export const PILOT_SUPPLIER_USD = 10.28;
// This single supervised purchase is approved for exactly ₦16,735.73.
// A different live quote requires a new approval before any wallet debit.
export const PILOT_APPROVED_KOBO = 1673573;

export function getGiftCardPilotConfig() {
  if (process.env.OGABASSEY_GIFT_CARD_PILOT !== 'true') return null;
  const parsed = settings.safeParse({
    userId: process.env.GIFT_CARD_PILOT_USER_ID,
    orderId: process.env.GIFT_CARD_PILOT_ORDER_ID,
    presentationKey: process.env.GIFT_CARD_WALLET_QUOTE_HMAC,
  });
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    presentationKey: createHmac('sha256', parsed.data.presentationKey)
      .update('baci:gift-card-pilot-presentation-key:v1')
      .digest('hex'),
  };
}
