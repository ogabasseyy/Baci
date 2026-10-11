import { z } from 'zod';
import { sanitizeWalletReturnTo } from '@/lib/sanitize-wallet-return-to';

const scope = z.strictObject({ merchantId: z.uuid(), userId: z.uuid() });
const consent = z.strictObject({
  version: z.literal('primary-wallet-card-v1'),
  oneTimeCharge: z.literal(true),
  saveCard: z.boolean(),
});
// Paystack rejects card charges below NGN 50 (5000 kobo).
export const PRIMARY_WALLET_CARD_MIN_AMOUNT_KOBO = 5000;
// Single source of truth for the Paystack checkout hostname allowlist:
// both the launch params and the funding client pin to this exact
// host. If Paystack ever announces a hostname migration, update this
// constant (and its test pin) — not the call sites.
export const PRIMARY_WALLET_CARD_PAYSTACK_CHECKOUT_HOSTNAME =
  'checkout.paystack.com';
const amountKobo = z
  .number()
  .int()
  .min(PRIMARY_WALLET_CARD_MIN_AMOUNT_KOBO)
  .max(9999999999);
const response = z
  .object({
    operationId: z.uuid(),
    amountKobo,
    currency: z.literal('NGN'),
    // Stored save-card choice echoed by the server. Optional: older
    // servers predate the echo, and adoption must not misfire against
    // them — the client only treats a defined mismatch as adoption.
    saveCard: z.boolean().optional(),
    reference: z.string().regex(/^pvb-first-primary-[0-9a-f-]{36}$/),
    status: z.enum([
      'reserved',
      'initializing',
      'init_unknown',
      'ready',
      'custody_pending',
      'reconciliation_required',
      'completed',
      'abandoned',
    ]),
    authorizationUrl: z
      .string()
      .refine((value) => {
        // Hostname-checked parsing instead of a tight path regex: the
        // provider may add path segments, hyphens, or query strings, and
        // rejecting a legitimate checkout URL would strand the shopper.
        try {
          const parsed = new URL(value);
          return (
            parsed.protocol === 'https:' &&
            parsed.hostname === PRIMARY_WALLET_CARD_PAYSTACK_CHECKOUT_HOSTNAME
          );
        } catch {
          return false;
        }
      })
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
