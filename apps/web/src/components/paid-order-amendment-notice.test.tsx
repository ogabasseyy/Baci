import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PaidOrderAmendmentNotice } from './paid-order-amendment-notice';

it('shows the amount due and the fulfillment hold for an upgrade', () => {
  render(
    <PaidOrderAmendmentNotice
      currency="NGN"
      amendment={{
        state: 'awaiting_payment',
        holdFulfillment: true,
        balanceDueMinor: 125_000,
        refundOwedMinor: 0,
        documentId: null,
        documentNumber: null,
      }}
    />
  );
  expect(screen.getByRole('alert')).toHaveTextContent(/balance due .*1,250/iu);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Fulfillment is on hold.'
  );
});
