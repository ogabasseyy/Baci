import 'server-only';
import type { BankCardOffer } from '@/schemas/bank-card-offer';
import { bankCardOffersSchema } from '@/schemas/bank-card-offers';

// Add bank-approved terms after the checkout and persistence paths are wired.
const configuredOffers: readonly BankCardOffer[] = [];

export const BANK_CARD_OFFERS = bankCardOffersSchema.parse(configuredOffers);
