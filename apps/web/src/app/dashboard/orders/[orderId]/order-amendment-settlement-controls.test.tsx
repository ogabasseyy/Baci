import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { workspaceSchema } from '@/schemas/order-amendment';
import { OrderAmendmentSettlementControls } from './order-amendment-settlement-controls';

const workspace = workspaceSchema.parse({
  canStart: false,
  canEdit: true,
  canRefund: false,
  customer: {
    state: 'awaiting_payment',
    holdFulfillment: true,
    balanceDueMinor: 50_000,
    refundOwedMinor: 0,
    documentId: null,
    documentNumber: null,
  },
  summary: { amendmentId: '11111111-1111-4111-8111-111111111111' },
  events: [],
  refunds: [],
  bankEvidence: [],
});

it('does not render settlement actions for staff without order edit permission', () => {
  const { container } = render(
    <OrderAmendmentSettlementControls
      workspace={{ ...workspace, canEdit: false }}
      currency="NGN"
      cancelled={false}
      disabled={false}
      submit={vi.fn()}
    />
  );
  expect(container).toBeEmptyDOMElement();
});

it('keeps top-up inactive until verified bank evidence is selected', () => {
  render(
    <OrderAmendmentSettlementControls
      workspace={workspace}
      currency="NGN"
      cancelled={false}
      disabled={false}
      submit={vi.fn()}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Record verified transfer' })
  ).toBeDisabled();
});

it('records a verified lender refund using its dedicated command', () => {
  const submit = vi.fn();
  render(
    <OrderAmendmentSettlementControls
      workspace={{
        ...workspace,
        canRefund: true,
        isVerifiedFunding: true,
        verifiedCreditDirectRefund: true,
      }}
      currency="NGN"
      cancelled={false}
      disabled={false}
      submit={submit}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Record verified Credit Direct refund' })
  );
  expect(submit).toHaveBeenCalledWith({
    action: 'record_verified_lender_refund',
  });
  expect(
    screen.queryByRole('button', { name: 'Record verified transfer' })
  ).toBeNull();
});

it.each([
  [false, 'Put order on hold for cancellation', 'open_verified_cancellation'],
  [true, 'Cancel with verified refunds', 'cancel_with_verified_refunds'],
])('uses the right financing cancellation command when evidence is complete = %s', (ready, label, action) => {
  const submit = vi.fn();
  render(
    <OrderAmendmentSettlementControls
      workspace={{
        ...workspace,
        canRefund: true,
        isVerifiedFunding: true,
        canOpenVerifiedCancellation: !ready,
        verifiedCancellationPending: ready,
        verifiedCancellationReady: ready,
      }}
      currency="NGN"
      cancelled={false}
      disabled={false}
      submit={submit}
    />
  );
  const button = screen.getByRole('button', { name: label });
  expect(button).toBeDisabled();
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Cancellation reason' }),
    { target: { value: 'Customer request' } }
  );
  fireEvent.click(button);
  expect(submit).toHaveBeenCalledWith({ action, reason: 'Customer request' });
});

it('lets Finance prepare and verify a late bank repayment during the cancellation hold', () => {
  const submit = vi.fn();
  const evidenceId = 'd806f297-76d6-4a84-9ae5-477902cc9eaf';
  const claimId = '41ee7d0c-4ed9-4c51-9aea-9868b3ebfb9f';
  const outgoingId = 'c5ace27d-16c1-40e3-8af3-f9671e3148bd';
  const pendingCancellation = {
    ...workspace,
    canRefund: true,
    isVerifiedFunding: true,
    verifiedCancellationPending: true,
    bankEvidence: [
      {
        id: evidenceId,
        amountMinor: 500_000,
        method: 'bank_transfer',
        occurredAt: '2026-11-23T06:00:00Z',
        status: null,
        transactionId: null,
      },
    ],
  };
  const props = { currency: 'NGN', cancelled: false, disabled: false, submit };
  const { rerender } = render(
    <OrderAmendmentSettlementControls
      {...props}
      workspace={pendingCancellation}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Prepare bank repayment/ })
  );
  expect(submit).toHaveBeenCalledWith({
    action: 'claim_offline_disbursement',
    sourceId: evidenceId,
    sourceKind: 'unapplied',
  });
  expect(
    screen.queryByRole('button', { name: 'Cancel with verified refunds' })
  ).toBeNull();

  rerender(
    <OrderAmendmentSettlementControls
      {...props}
      workspace={{
        ...pendingCancellation,
        events: [
          {
            id: 1,
            type: 'offline_disbursement_claimed',
            details: { claimId },
            createdAt: '2026-11-23T06:02:00Z',
          },
        ],
      }}
    />
  );
  fireEvent.change(
    screen.getByLabelText('Verified outgoing bank evidence ID'),
    {
      target: { value: outgoingId },
    }
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Verify bank repayment' })
  );
  expect(submit).toHaveBeenLastCalledWith({
    action: 'record_offline_refund',
    claimId,
    evidenceId: outgoingId,
  });
});
