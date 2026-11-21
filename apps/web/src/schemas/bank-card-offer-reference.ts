import { z } from 'zod';

// The database creates BCO- plus PostgreSQL UUID text with hyphens
// removed. Paystack must return that exact lowercase hexadecimal identity.
export const bankCardOfferReferenceSchema = z
  .string()
  .regex(/^BCO-[a-f0-9]{32}$/);
