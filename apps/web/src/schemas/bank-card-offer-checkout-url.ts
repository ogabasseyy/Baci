import { z } from 'zod';

export const bankCardOfferCheckoutUrlSchema = z
  .string()
  .max(2048)
  .regex(
    /^https:\/\/checkout[.]paystack[.]com\/[A-Za-z0-9._~%/-]+(?:\?[A-Za-z0-9._~%+&=;:@,/?-]+)?$/
  );
