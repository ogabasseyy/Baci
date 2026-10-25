import { z } from 'zod';

const reference = z.string().trim().min(1).max(256);
const timestamp = z.iso.datetime({ offset: true, local: true });
// Match supported NGN precision and safe integer kobo without rounding.
const decimal = /^(\d+)(?:\.(\d{1,2}))?$/;
function supportedMoney(value: string | number): boolean {
  const match = decimal.exec(String(value));
  return (
    !!match &&
    BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0')) <=
      BigInt(Number.MAX_SAFE_INTEGER)
  );
}
const numericMoney = z.number().finite().nonnegative().refine(supportedMoney);
const stringMoney = z.string().max(32).regex(decimal).refine(supportedMoney);

const activatedLoan = z.object({
  loan_reference: reference,
  loan_request_reference: reference,
  loan_id: z.number().int().positive().safe(),
  loan_identifier: reference,
  loan_amount: numericMoney,
  // Equity only here; approval's first_repayment includes charges.
  first_repayment: numericMoney,
  loan_tenure: z.number().int().positive(),
  activated_at: timestamp,
});
const settlementFields = {
  event_id: reference,
  status: z.literal('SUBMITTED'),
  partner_reference: reference,
  amount: numericMoney,
  occurred_at: timestamp,
  previous_webhook_sent_at: timestamp.nullable(),
  previous_activations_captured_at: timestamp.nullable(),
  activations_captured_at: timestamp,
  activation_audit_scope: z.literal('partner'),
  activated_loan_count: z.number().int().nonnegative(),
  activated_loans: z.array(activatedLoan).max(1000),
};
const partnerSettlement = z.object({
  ...settlementFields,
  webhook_type: z.literal('partner_settlement'),
  partner_identifier: reference,
  partner_name: reference,
});
const vendorSettlement = z.object({
  ...settlementFields,
  webhook_type: z.literal('vendor_settlement'),
  vendor_identifier: reference,
  vendor_name: reference,
});
const transaction = z.object({
  webhook_type: z.never().optional(),
  phone_number: reference,
  transaction_reference: reference,
  amount_deducted: stringMoney,
  amount_sent: stringMoney,
  // Provider's field name identifies a BOOKED loan, not the application.
  loan_request_reference: reference,
});
const address = z.object({
  webhook_type: z.literal('address_status_update'),
  phone_number: reference,
  address_validated: z.literal(true),
});

// Unknown fields are stripped; unknown event types/statuses fail closed.
export const oxygenWebhookSchema = z
  .union([partnerSettlement, vendorSettlement, transaction, address])
  .refine(
    (event) =>
      !('activated_loans' in event) ||
      event.activated_loan_count === event.activated_loans.length
  );
