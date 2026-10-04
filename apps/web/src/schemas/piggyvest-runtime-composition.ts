import { z } from 'zod';
import { piggyvestCustomerPolicyContextSchemas } from './piggyvest-customer-policy-context';
import { piggyvestCustomerPolicyRequestSchemas } from './piggyvest-customer-policy-request';

export const piggyvestRuntimeCompositionSchemas = {
  configuration: z.strictObject({
    mode: z.literal('local_test'),
    goalId: z.uuid().transform((value) => value.toLowerCase()),
    context: piggyvestCustomerPolicyContextSchemas.configuration,
    termsDocument: piggyvestCustomerPolicyRequestSchemas.terms,
  }),
  origin: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.origin === value &&
        url.protocol === 'http:' &&
        url.hostname === '127.0.0.1' &&
        Number(url.port) >= 1024 &&
        url.username === '' &&
        url.password === ''
      );
    } catch {
      return false;
    }
  }),
  port: z.union([z.literal(0), z.number().int().min(1024).max(65535)]),
};
