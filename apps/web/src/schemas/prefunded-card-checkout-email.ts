import { z } from 'zod';

export const prefundedCardCheckoutEmailSchema = z
  .email()
  .max(254)
  .refine(
    (value) => !/\.(?:invalid|test|example|localhost|local)$/i.test(value),
    'Checkout email must use a public domain'
  );
