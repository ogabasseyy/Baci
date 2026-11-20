import { z } from 'zod';

export const bankCardOfferReferenceSchema = z
  .string()
  .regex(/^BCO-[a-f0-9]{32}$/);
