import { z } from 'zod';

export const agenticCheckoutCurrencySchema = z
  .string()
  .trim()
  .length(3, 'Currency must be a 3-letter ISO code')
  .transform((value) => value.toUpperCase())
  .default('NGN');
