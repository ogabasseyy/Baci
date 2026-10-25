import { describe, expect, it } from 'vitest';
import samples from './__fixtures__/webhook-samples.json';
import { parseOxygenWebhook } from './webhook';

const transaction = {
  phone_number: '08000000000',
  transaction_reference: 'txn-example-001',
  amount_deducted: '145135.00',
  amount_sent: '145135.00',
  loan_request_reference: 'fe448e69-9e01-47b6-a1f9-f90ab6455ea8',
};
const settlement = {
  webhook_type: 'partner_settlement',
  event_id: '47a7eae5-c128-4bd9-9bfb-d47cc2ec7996',
  status: 'SUBMITTED',
  partner_reference: 'partner-example',
  partner_identifier: 'partner-id-example-001',
  partner_name: 'Example Partner',
  amount: 400000,
  occurred_at: '2026-10-20T11:00:00',
  previous_webhook_sent_at: null,
  previous_activations_captured_at: null,
  activations_captured_at: '2026-10-20T11:00:02Z',
  activation_audit_scope: 'partner',
  activated_loan_count: 0,
  activated_loans: [],
};

describe('Oxygen webhook contract', () => {
  it.each(
    Object.entries(samples)
  )('recognises the official synthetic %s', (_name, sample) => {
    expect(parseOxygenWebhook(sample)).not.toBeNull();
  });
  it('keeps principal and equity in the audit separate from the payout', () => {
    const sample = samples['Vendor settlement callback'];
    expect(parseOxygenWebhook({ ...sample, amount: 400000 })).toMatchObject({
      amountMinor: 40000000,
      activationAudit: {
        loans: [{ principalMinor: 7500000, equityMinor: 2500000 }],
      },
    });
  });
  it('treats the misleading transaction request field as the booked loan and requires reconciliation', () => {
    expect(parseOxygenWebhook(transaction)).toMatchObject({
      kind: 'transaction',
      bookedLoanReference: transaction.loan_request_reference,
      amountSentMinor: 14513500,
      action: 'reconcile_payment_setup',
      deduplicationKey: 'transaction:txn-example-001',
    });
  });
  it('uses the settlement payout rather than the unrelated partner-wide activation audit', () => {
    expect(parseOxygenWebhook(settlement)).toMatchObject({
      kind: 'settlement',
      amountMinor: 40000000,
      payoutStatus: 'submitted',
      action: 'record_submitted_settlement',
      deduplicationKey: 'settlement:47a7eae5-c128-4bd9-9bfb-d47cc2ec7996',
      occurredAt: '2026-10-20T11:00:00',
    });
  });
  it('accepts vendor settlement separately from direct partner settlement', () => {
    const {
      partner_identifier: _id,
      partner_name: _name,
      ...common
    } = settlement;
    expect(
      parseOxygenWebhook({
        ...common,
        webhook_type: 'vendor_settlement',
        vendor_identifier: 'vendor-001',
        vendor_name: 'Example Merchant',
      })
    ).toMatchObject({
      kind: 'settlement',
      recipientType: 'vendor',
      recipientIdentifier: 'vendor-001',
    });
  });
  it('routes successful address callbacks to KYC lookup without inventing a request reference', () => {
    expect(
      parseOxygenWebhook({
        webhook_type: 'address_status_update',
        phone_number: '08000000000',
        address_validated: true,
      })
    ).toEqual({
      kind: 'address',
      phoneNumber: '08000000000',
      action: 'reconcile_kyc',
    });
  });
  it.each([
    { ...transaction, amount_sent: '1.001' },
    { ...transaction, amount_sent: 145135 },
    { ...transaction, amount_sent: '-1.00' },
    { ...settlement, amount: '400000.00' },
    { ...settlement, amount: 0.001 },
    { ...settlement, status: 'SUCCESS' },
    { ...settlement, partner_reference: '' },
    { ...settlement, event_id: '' },
    { ...settlement, activated_loan_count: 1 },
    { ...settlement, occurred_at: 'not-a-date' },
    { ...transaction, webhook_type: 'new_unknown_event' },
    {
      webhook_type: 'address_status_update',
      phone_number: '08000000000',
      address_validated: false,
    },
  ])('rejects malformed or undocumented financial payload %#', (input) => {
    expect(parseOxygenWebhook(input)).toBeNull();
  });
});
