import { BANK_CARD_OFFER_REFERENCE_PATTERN } from '@baci/shared/constants';
import { z } from 'zod';

export const bankCardOfferReferenceSchema = z
  .string()
  .regex(BANK_CARD_OFFER_REFERENCE_PATTERN);
