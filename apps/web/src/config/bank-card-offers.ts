import 'server-only';
import { logger } from '@/lib/logger';
import type { BankCardOffer } from '@/schemas/bank-card-offer';
import { bankCardOffersSchema } from '@/schemas/bank-card-offers';

// Enable an offer after the bank approves its terms and live issuer verification and refunds are confirmed.
const configuredOffers: readonly BankCardOffer[] = [];

// Keep standard checkout available if a future campaign has invalid settings.
const parsedOffers = bankCardOffersSchema.safeParse(configuredOffers);
if (!parsedOffers.success) {
  logger.warn({
    message: 'Invalid bank card offer configuration; offers disabled',
  });
}

export const BANK_CARD_OFFERS = parsedOffers.success ? parsedOffers.data : [];
