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
  it('keeps provider loan and repayment amounts separate from the payout', () => {
    const sample = samples['Vendor settlement callback'];
    expect(parseOxygenWebhook({ ...sample, amount: 400000 })).toMatchObject({
      providerAmount: 400000,
      activationAudit: {
        loans: [{ providerLoanAmount: 75000, providerFirstRepayment: 25000 }],
      },
    });
  });
  it('treats the misleading transaction request field as the booked loan and requires reconciliation', () => {
    expect(parseOxygenWebhook(transaction)).toMatchObject({
      kind: 'transaction',
      bookedLoanReference: transaction.loan_request_reference,
      providerAmountSent: '145135.00',
      action: 'reconcile_payment_setup',
      deduplicationKey: 'transaction:txn-example-001',
    });
  });
  it('uses the settlement payout rather than the unrelated partner-wide activation audit', () => {
    expect(parseOxygenWebhook(settlement)).toMatchObject({
      kind: 'settlement',
      providerAmount: 400000,
      payoutStatus: 'submitted',
      action: 'record_submitted_settlement',
      deduplicationKey: 'settlement:47a7eae5-c128-4bd9-9bfb-d47cc2ec7996',
      occurredAt: '2026-10-20T11:00:00',
    });
  });
  it('preserves provider amounts without asserting a currency or unit', () => {
    const transactionEvent = parseOxygenWebhook(transaction);
    expect(transactionEvent).toMatchObject({
      providerAmountDeducted: '145135.00',
      providerAmountSent: '145135.00',
    });
    expect(transactionEvent).not.toHaveProperty('amountSentMinor');
    const settlementEvent = parseOxygenWebhook(
      samples['Vendor settlement callback']
    );
    expect(settlementEvent).not.toHaveProperty('amountMinor');
    expect(
      settlementEvent?.kind === 'settlement' &&
        settlementEvent.activationAudit.loans[0]
    ).not.toHaveProperty('principalMinor');
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
      addressValidated: true,
      action: 'reconcile_kyc',
    });
  });
  it('uses a stable address key only when the application reference is present', () => {
    const base = {
      webhook_type: 'address_status_update',
      phone_number: '08000000000',
      address_validated: true,
    };
    expect(parseOxygenWebhook(base)).not.toHaveProperty('deduplicationKey');
    const first = parseOxygenWebhook({
      ...base,
      loan_request_reference: 'application-a',
    });
    const retry = parseOxygenWebhook({
      ...base,
      loan_request_reference: 'application-a',
    });
    const other = parseOxygenWebhook({
      ...base,
      loan_request_reference: 'application-b',
    });
    expect(first).toHaveProperty(
      'deduplicationKey',
      expect.stringMatching(/^address:[a-f0-9]{64}$/)
    );
    expect(first).toEqual(retry);
    expect(first?.deduplicationKey).not.toBe(other?.deduplicationKey);
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
  ])('rejects malformed or undocumented financial payload %#', (input) => {
    expect(parseOxygenWebhook(input)).toBeNull();
  });
});

it('preserves the application reference supplied by a real address callback', () => {
  expect(
    parseOxygenWebhook({
      webhook_type: 'address_status_update',
      phone_number: '08000000000',
      loan_request_reference: '60000000-0000-4000-8000-000000000001',
      address_validated: true,
    })
  ).toEqual({
    kind: 'address',
    phoneNumber: '08000000000',
    applicationReference: '60000000-0000-4000-8000-000000000001',
    addressValidated: true,
    deduplicationKey: expect.stringMatching(/^address:[a-f0-9]{64}$/),
    action: 'reconcile_kyc',
  });
});

it('deduplicates identical address hints without collapsing changed status or application', () => {
  const base = {
    webhook_type: 'address_status_update',
    phone_number: '08000000000',
    loan_request_reference: '60000000-0000-4000-8000-000000000001',
    address_validated: true,
  };
  const first = parseOxygenWebhook(base);
  const duplicate = parseOxygenWebhook({ ...base });
  const changedStatus = parseOxygenWebhook({
    ...base,
    address_validated: false,
  });
  const changedApplication = parseOxygenWebhook({
    ...base,
    loan_request_reference: '60000000-0000-4000-8000-000000000002',
  });
  expect(first?.deduplicationKey).toBe(duplicate?.deduplicationKey);
  expect(first?.deduplicationKey).not.toBe(changedStatus?.deduplicationKey);
  expect(first?.deduplicationKey).not.toBe(
    changedApplication?.deduplicationKey
  );
  expect(changedStatus).toMatchObject({
    kind: 'address',
    addressValidated: false,
    action: 'reconcile_kyc',
  });
  expect(first?.deduplicationKey).not.toContain(base.phone_number);
});

it.each([
  true,
  false,
])('accepts the documented selfie callback (%s) as a scoped KYC hint', (selfie) => {
  const event = parseOxygenWebhook({
    webhook_type: 'selfie_status_update',
    phone_number: '2348000000000',
    loan_request_reference: 'application-1',
    selfie,
  });
  expect(event).toMatchObject({
    kind: 'selfie',
    applicationReference: 'application-1',
    selfieConfirmed: selfie,
    action: 'reconcile_kyc',
  });
});

it('separates selfie callback keys by application and confirmation outcome', () => {
  const body = {
    webhook_type: 'selfie_status_update',
    phone_number: '2348000000000',
    loan_request_reference: 'application-1',
    selfie: true,
  };
  const key = parseOxygenWebhook(body)?.deduplicationKey;
  expect(key).toBeTruthy();
  expect(parseOxygenWebhook(body)?.deduplicationKey).toBe(key);
  expect(
    parseOxygenWebhook({ ...body, selfie: false })?.deduplicationKey
  ).not.toBe(key);
  expect(
    parseOxygenWebhook({ ...body, loan_request_reference: 'application-2' })
      ?.deduplicationKey
  ).not.toBe(key);
});
