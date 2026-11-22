import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OrderAmendmentVerifiedSettlement } from './order-amendment-verified-settlement';

const workspace = {
  canStart: false,
  canEdit: true,
  canRefund: true,
  canOpenVerifiedCancellation: true,
  verifiedCancellationReady: true,
  verifiedCancellationPending: true,
  isVerifiedFunding: true,
  customer: null,
  summary: null,
  events: [],
  refunds: [],
  bankEvidence: [],
};

it('requires refund permission even when all cancellation evidence is ready', () => {
  const { container } = render(
    <OrderAmendmentVerifiedSettlement
      workspace={{ ...workspace, canRefund: false }}
      disabled={false}
      reason="Customer request"
      setReason={vi.fn()}
      submit={vi.fn()}
    />
  );
  expect(container).toBeEmptyDOMElement();
});

it('disables the ready cancellation while another action is in flight', () => {
  render(
    <OrderAmendmentVerifiedSettlement
      workspace={workspace}
      disabled
      reason="Customer request"
      setReason={vi.fn()}
      submit={vi.fn()}
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Refund evidence is complete'
  );
  const button = screen.getByRole('button', {
    name: 'Cancel with verified refunds',
  });
  expect(button).toBeDisabled();
});
