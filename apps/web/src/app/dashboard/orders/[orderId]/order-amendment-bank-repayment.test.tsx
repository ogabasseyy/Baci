import { render, screen } from '@testing-library/react';
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
  ).toHaveLength(1);
});
