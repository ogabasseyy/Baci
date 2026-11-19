import 'server-only';
import type { BankCardOffer } from '@/schemas/bank-card-offer';
import { bankCardOffersSchema } from '@/schemas/bank-card-offers';

// Enable an offer after the bank approves its terms and live issuer verification and refunds are confirmed.
const configuredOffers: readonly BankCardOffer[] = [];

export const BANK_CARD_OFFERS = bankCardOffersSchema.parse(configuredOffers);
