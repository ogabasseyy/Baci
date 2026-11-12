import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

// The shared ledger bound for one PiggyVest amount (kobo).
export const WALLET_PAY_MAX_AMOUNT_KOBO = 9999999999;

const amountKobo = z.int().positive().max(WALLET_PAY_MAX_AMOUNT_KOBO);
const purpose = z.enum(['imei_check', 'vtu']);
// Same rule as the wallet_payments.purchase_ref CHECK.
const purchaseRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const reference = z
  .string()
  .regex(/^pvb-(pay|refund)-[0-9a-f-]{36}(-[1-9][0-9]?)?$/);
const pinProof = z.string().regex(/^[0-9a-f]{64}$/);

function oneResultRow<T extends z.ZodType>(result: T) {
  return z.array(z.strictObject({ result })).length(1);
}

const paymentReservation = z.strictObject({
  operationId: z.uuid(),
  purpose,
  purchaseRef,
  amountKobo,
  sourceWalletId: piggyvestProviderIdSchema,
  destinationWalletId: piggyvestProviderIdSchema,
  reference,
  businessId: piggyvestProviderIdSchema,
  providerCustomerId: piggyvestProviderIdSchema,
});

const refundReservation = z.strictObject({
  refundId: z.uuid(),
  operationId: z.uuid(),
  amountKobo,
  sourceWalletId: piggyvestProviderIdSchema,
  destinationWalletId: piggyvestProviderIdSchema,
  reference,
  businessId: piggyvestProviderIdSchema,
  providerCustomerId: piggyvestProviderIdSchema,
});

const issueResult = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('issued'),
    operationId: z.uuid(),
    amountKobo,
    expiresAt: z.string(),
  }),
  z.strictObject({
    status: z.enum(['pending', 'confirmed', 'needs_review']),
    operationId: z.uuid(),
    amountKobo,
  }),
  z.strictObject({ status: z.enum(['conflict', 'unavailable']) }),
]);

const reserveResult = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('claimed'),
    reservation: paymentReservation,
  }),
  z.strictObject({
    status: z.enum([
      'pending',
      'confirmed',
      'needs_review',
      'released',
      'expired',
      'conflict',
      'unavailable',
    ]),
  }),
  z.strictObject({
    status: z.literal('pin_refused'),
    reason: z.string().max(32),
  }),
]);

const issuedBinding = z.strictObject({
  operationId: z.uuid(),
  purpose,
  purchaseRef,
  amountKobo,
  pinKeySha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const paymentStatus = z.strictObject({
  state: z.enum([
    'issued',
    'reserved',
    'dispatched',
    'confirmed',
    'released',
    'needs_review',
  ]),
  fulfilment: z.enum([
    'awaiting',
    'claimed',
    'fulfilled',
    'refund_owed',
    'refunded',
  ]),
  purpose,
  purchaseRef,
  amountKobo,
  refund: z
    .enum(['owed', 'dispatched', 'confirmed', 'released', 'needs_review'])
    .nullable(),
});

const claimResult = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.enum(['claimed', 'reclaimed']),
    purpose,
    purchaseRef,
    amountKobo,
    // Only the current claimant may finish delivery with it.
    claimToken: z.uuid(),
  }),
  z.strictObject({
    status: z.enum([
      'not_found',
      'not_confirmed',
      'busy',
      'fulfilled',
      'refund_owed',
      'refunded',
    ]),
  }),
]);

const workList = z.strictObject({
  deliver: z.array(z.uuid()).max(200),
  refund: z.array(z.uuid()).max(200),
  settle: z.array(z.uuid()).max(200),
});

export const piggyvestWalletPaySchemas = {
  purpose,
  purchaseRef,
  amountKobo,
  operationId: z.uuid(),
  reference,
  pinProof,
  issueRequest: z.strictObject({ purpose, purchaseRef, amountKobo }),
  paymentReservation,
  refundReservation,
  issueRows: oneResultRow(issueResult),
  reserveRows: oneResultRow(reserveResult),
  issuedRows: oneResultRow(issuedBinding.nullable()),
  manageRows: oneResultRow(z.boolean()),
  statusRows: oneResultRow(paymentStatus.nullable()),
  claimRows: oneResultRow(claimResult),
  finishRows: oneResultRow(
    z.enum(['fulfilled', 'refund_owed', 'duplicate', 'conflict'])
  ),
  owedRefundRows: oneResultRow(refundReservation.nullable()),
  workRows: oneResultRow(workList),
  paymentDispatchedRows: oneResultRow(paymentReservation.nullable()),
  refundDispatchedRows: oneResultRow(refundReservation.nullable()),
  transferByReferenceRows: oneResultRow(
    z
      .strictObject({
        kind: z.enum(['payment', 'refund']),
        operationId: z.uuid(),
        reference,
        // Already concluded by the status path: acknowledge the webhook.
        settled: z.boolean(),
      })
      .nullable()
  ),
  settlePaymentRows: oneResultRow(
    z.enum([
      'confirmed',
      'duplicate',
      'conflict',
      'needs_review',
      'deferred',
      'refunding',
    ])
  ),
  settleRefundRows: oneResultRow(
    z.enum(['confirmed', 'duplicate', 'conflict', 'needs_review'])
  ),
  // needs_review: a failed record that still charged a fee.
  releaseRows: oneResultRow(
    z.enum(['released', 'duplicate', 'conflict', 'needs_review'])
  ),
  // A wallet read at PiggyVest. A business (collection) wallet carries no
  // api_customer_id; a customer wallet must.
  wallet: z.object({
    id: piggyvestProviderIdSchema,
    api_customer_id: piggyvestProviderIdSchema
      .nullish()
      .transform((value) => value ?? undefined),
    business_id: piggyvestProviderIdSchema,
    currency: z.literal('NGN'),
    status: z.literal('active'),
    balance: z.int().nonnegative(),
    // A frozen wallet or one under a lien can not pay or be paid: whether
    // PiggyVest blocks business-initiated transfers on them is unknown, so
    // wallet pay fails closed.
    is_frozen: z.boolean().nullable().optional(),
    has_an_active_lien: z.boolean().nullable().optional(),
  }),
};

export type WalletPayPaymentReservation = z.infer<typeof paymentReservation>;
export type WalletPayRefundReservation = z.infer<typeof refundReservation>;
export type WalletPayPurpose = z.infer<typeof purpose>;
