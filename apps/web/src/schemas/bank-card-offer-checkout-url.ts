import { z } from 'zod';

// Keep aligned with the replacement record_bank_card_offer_checkout_url
// in 20261119153530_bank_card_offer_recovery_and_immutability.sql.
export const bankCardOfferCheckoutUrlSchema = z
  .string()
  .max(2048)
  .regex(
    /^https:\/\/checkout[.]paystack[.]com\/[A-Za-z0-9._~%/-]+(?:\?[A-Za-z0-9._~%+&=;:@,/?-]+)?$/
  );
