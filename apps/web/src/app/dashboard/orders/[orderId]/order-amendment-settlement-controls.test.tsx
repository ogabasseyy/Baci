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
