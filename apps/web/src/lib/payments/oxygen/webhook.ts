import 'server-only';

import { oxygenWebhookSchema } from '@/schemas/oxygen-webhook';
import { toOxygenMinorUnits } from './money';

/** Server-side contract normalisation only; it never changes a financial state. */
export function parseOxygenWebhook(input: unknown) {
  const parsed = oxygenWebhookSchema.safeParse(input);
  if (!parsed.success) return null;
  const event = parsed.data;
  if (event.webhook_type === 'address_status_update') {
    return {
      kind: 'address' as const,
      phoneNumber: event.phone_number,
      action: 'reconcile_kyc' as const,
    };
  }
  if (event.webhook_type === undefined) {
    return {
      kind: 'transaction' as const,
      bookedLoanReference: event.loan_request_reference,
      transactionReference: event.transaction_reference,
      amountDeductedMinor: toOxygenMinorUnits(event.amount_deducted, 'NGN'),
      amountSentMinor: toOxygenMinorUnits(event.amount_sent, 'NGN'),
      deduplicationKey: `transaction:${event.transaction_reference}`,
      action: 'reconcile_payment_setup' as const,
    };
  }
  const recipient =
    event.webhook_type === 'vendor_settlement'
      ? {
          recipientType: 'vendor' as const,
          recipientIdentifier: event.vendor_identifier,
        }
      : {
          recipientType: 'partner' as const,
          recipientIdentifier: event.partner_identifier,
        };
  return {
    kind: 'settlement' as const,
    ...recipient,
    eventId: event.event_id,
    partnerReference: event.partner_reference,
    amountMinor: toOxygenMinorUnits(event.amount, 'NGN'),
    payoutStatus: 'submitted' as const,
    occurredAt: event.occurred_at, // Preserve unspecified timezone; never infer UTC.
    deduplicationKey: `settlement:${event.event_id}`,
    action: 'record_submitted_settlement' as const,
    activationAudit: {
      scope: 'partner' as const,
      capturedAt: event.activations_captured_at,
      previousCapturedAt: event.previous_activations_captured_at,
      previousWebhookSentAt: event.previous_webhook_sent_at,
      loans: event.activated_loans.map((loan) => ({
        bookedLoanReference: loan.loan_reference,
        applicationReference: loan.loan_request_reference,
        loanIdentifier: loan.loan_identifier,
        principalMinor: toOxygenMinorUnits(loan.loan_amount, 'NGN'),
        equityMinor: toOxygenMinorUnits(loan.first_repayment, 'NGN'),
        tenure: loan.loan_tenure,
        activatedAt: loan.activated_at,
      })),
    },
  };
}

export type OxygenWebhookEvent = NonNullable<
  ReturnType<typeof parseOxygenWebhook>
>;
