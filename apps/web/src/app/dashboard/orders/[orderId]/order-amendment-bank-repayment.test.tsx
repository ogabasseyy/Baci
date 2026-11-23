import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { workspaceSchema } from '@/schemas/order-amendment';
import { OrderAmendmentBankRepayment } from './order-amendment-bank-repayment';

it('offers only bank transfers for repayment from a verified cancellation', () => {
  const entry = {
    amountMinor: 500_000,
    occurredAt: '2026-11-23T06:00:00Z',
    status: null,
    transactionId: null,
  };
  const workspace = workspaceSchema.parse({
    canStart: false,
    canEdit: true,
    canRefund: true,
    isVerifiedFunding: true,
    verifiedCancellationPending: true,
    customer: null,
    summary: null,
    events: [],
    refunds: [],
    bankEvidence: [
      {
        ...entry,
        id: 'a6bc20fe-fae1-4439-a228-e7317a31a1cb',
        method: 'bank_transfer',
      },
      { ...entry, id: '42bd8acc-2396-4be1-9c6e-ef95c35e55f7', method: 'pos' },
      {
        ...entry,
        id: '2fdf5fd3-a24d-49de-9cf2-9208363d4653',
        method: 'bank_transfer',
        status: 'top_up',
        transactionId: '9d165858-13b4-47d7-a4eb-38f97bb6c182',
      },
    ],
  });
  render(
    <OrderAmendmentBankRepayment
      workspace={workspace}
      currency="NGN"
      cancelled={false}
      submit={vi.fn()}
    />
  );
  expect(
    screen.getAllByRole('button', { name: /Prepare bank repayment/ })
  ).toHaveLength(2);
});

it('requires a UUID before submitting outgoing refund evidence', () => {
  const submit = vi.fn();
  const workspace = workspaceSchema.parse({
    canStart: false,
    canEdit: true,
    canRefund: true,
    isVerifiedFunding: true,
    customer: null,
    summary: null,
    events: [
      {
        id: 1,
        type: 'offline_disbursement_claimed',
        createdAt: '2026-11-23T06:00:00Z',
        details: { claimId: 'claim-1' },
      },
    ],
    refunds: [],
    bankEvidence: [],
  });
  render(
    <OrderAmendmentBankRepayment
      workspace={workspace}
      currency="NGN"
      cancelled={false}
      submit={submit}
    />
  );
  const input = screen.getByLabelText('Verified outgoing bank evidence ID');
  const button = screen.getByRole('button', { name: 'Verify bank repayment' });
  fireEvent.change(input, { target: { value: 'malformed' } });
  expect(button).toBeDisabled();
  fireEvent.change(input, {
    target: { value: '9d165858-13b4-47d7-a4eb-38f97bb6c182' },
  });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(submit).toHaveBeenCalledWith({
    action: 'record_offline_refund',
    claimId: 'claim-1',
    evidenceId: '9d165858-13b4-47d7-a4eb-38f97bb6c182',
  });
});
