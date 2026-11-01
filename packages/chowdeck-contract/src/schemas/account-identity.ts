import { z } from 'zod';
import isoCurrencies from '../../config/iso-4217-list-one.json';

const currentCurrencyCodes = new Set(isoCurrencies.codes);

export const accountIdentitySchema = z
  .object({
    domain: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/),
    vendorId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .refine((code) => currentCurrencyCodes.has(code)),
  })
  .strict();

export type ChowdeckAccountIdentityV1 = z.infer<typeof accountIdentitySchema>;
