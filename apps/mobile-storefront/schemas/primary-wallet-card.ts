import { z } from 'zod';
import { sanitizeWalletReturnTo } from '@/lib/sanitize-wallet-return-to';

const scope = z.strictObject({ merchantId: z.uuid(), userId: z.uuid() });
const consent = z.strictObject({
  version: z.literal('primary-wallet-card-v1'),
  oneTimeCharge: z.literal(true),
  saveCard: z.boolean(),
});
const amountKobo = z.number().int().positive().max(9999999999);
const response = z
  .object({
    operationId: z.uuid(),
    amountKobo,
    currency: z.literal('NGN'),
    reference: z.string().regex(/^pvb-first-primary-[0-9a-f-]{36}$/),
    status: z.enum([
      'reserved',
      'initializing',
      'init_unknown',
      'ready',
      'custody_pending',
      'reconciliation_required',
      'completed',
    ]),
    authorizationUrl: z
      .string()
      .regex(/^https:\/\/checkout\.paystack\.com\/[A-Za-z0-9]+$/)
      .optional(),
  })
  .refine(
    (value) => value.reference === `pvb-first-primary-${value.operationId}`
  )
  .refine((value) => value.status !== 'ready' || !!value.authorizationUrl);

export const primaryWalletCardSchemas = {
  scope,
  consent,
  response,
  start: scope.extend({
    amountKobo,
    consent,
    returnTo: z.string().optional().transform(sanitizeWalletReturnTo),
  }),
  pending: scope.extend({
    idempotencyKey: z.uuid(),
    amountKobo,
    consent,
    operationId: z.uuid().nullable(),
    returnTo: z.string().optional().transform(sanitizeWalletReturnTo),
  }),
};
