import 'server-only';
import { createHash } from 'node:crypto';

import { oxygenWebhookSchema } from '@/schemas/oxygen-webhook';

/** Preserve validated provider values without inferring units or changing financial state. */
export function parseOxygenWebhook(input: unknown) {
  const parsed = oxygenWebhookSchema.safeParse(input);
  if (!parsed.success) return null;
  const event = parsed.data;
  if (event.webhook_type === 'selfie_status_update') {
    return {
      kind: 'selfie' as const,
      phoneNumber: event.phone_number,
      applicationReference: event.loan_request_reference,
      selfieConfirmed: event.selfie,
      deduplicationKey: `selfie:${createHash('sha256')
        .update(
          JSON.stringify([
            event.phone_number,
            event.loan_request_reference,
            event.selfie,
          ])
        )
        .digest('hex')}`,
      action: 'reconcile_kyc' as const,
    };
  }
  if (event.webhook_type === 'address_status_update') {
    return {
      kind: 'address' as const,
      phoneNumber: event.phone_number,
      addressValidated: event.address_validated,
      // A phone-only delivery has no provider event identity. Let the inbox
      // assign a local per-delivery key so separate applications cannot collide.
      ...(event.loan_request_reference
        ? {
            applicationReference: event.loan_request_reference,
            deduplicationKey: `address:${createHash('sha256')
              .update(
                JSON.stringify([
                  event.phone_number,
                  event.loan_request_reference,
                  event.address_validated,
                ])
              )
              .digest('hex')}`,
          }
        : {}),
      action: 'reconcile_kyc' as const,
    };
  }
  if (event.webhook_type === undefined) {
    return {
      kind: 'transaction' as const,
      bookedLoanReference: event.loan_request_reference,
      transactionReference: event.transaction_reference,
      providerAmountDeducted: event.amount_deducted,
      providerAmountSent: event.amount_sent,
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
    providerAmount: event.amount,
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
        providerLoanAmount: loan.loan_amount,
        providerFirstRepayment: loan.first_repayment,
        tenure: loan.loan_tenure,
        activatedAt: loan.activated_at,
      })),
    },
  };
}

export type OxygenWebhookEvent = NonNullable<
  ReturnType<typeof parseOxygenWebhook>
>;
