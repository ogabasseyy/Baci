import { render, screen } from '@testing-library/react';
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
