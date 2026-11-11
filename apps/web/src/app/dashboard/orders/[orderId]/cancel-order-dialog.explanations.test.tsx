import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CancelOrderDialog } from './cancel-order-dialog';

const TEXTS = {
  cancelOnly: /no refund will be sent automatically/i,
  choice: /send the refund to the store owner for review, or cancel only/i,
  review: /the order will be cancelled and the refund sent to the store owner/i,
};

function renderDialog(props: {
  automaticSupported: boolean;
  canCancelOnly: boolean;
  inFlightAmount?: number;
}) {
  render(
    <CancelOrderDialog
      currency="NGN"
      isOpen
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      refundAmount={12500}
      {...props}
    />
  );
}

const shown = () =>
  Object.entries(TEXTS)
    .filter(([, pattern]) => screen.queryByText(pattern))
    .map(([key]) => key);

describe('CancelOrderDialog explanations', () => {
  it('shows no explanation when the refund is automatic and cancel-only is unselected', () => {
    renderDialog({ automaticSupported: true, canCancelOnly: true });
    expect(shown()).toEqual([]);
  });

  it('shows only the choice paragraph when review is needed and cancel-only is allowed', () => {
    renderDialog({ automaticSupported: false, canCancelOnly: true });
    expect(shown()).toEqual(['choice']);
  });

  it('shows only the review paragraph when review is needed without cancel-only permission', () => {
    renderDialog({ automaticSupported: false, canCancelOnly: false });
    expect(shown()).toEqual(['review']);
  });

  it('shows no explanation without cancel-only permission when the refund is automatic', () => {
    renderDialog({ automaticSupported: true, canCancelOnly: false });
    expect(shown()).toEqual([]);
  });

  it.each([
    true,
    false,
  ])('shows only the cancel-only paragraph once selected (automaticSupported=%s)', async (automaticSupported) => {
    renderDialog({ automaticSupported, canCancelOnly: true });
    await userEvent.click(screen.getByRole('radio', { name: /cancel only/i }));
    expect(shown()).toEqual(['cancelOnly']);
  });

  it('keeps the in-flight notice beside exactly one explanation', () => {
    renderDialog({
      automaticSupported: false,
      canCancelOnly: true,
      inFlightAmount: 5000,
    });
    expect(shown()).toEqual(['choice']);
    expect(
      screen.getByText(/already in progress with the provider/i)
    ).toBeVisible();
  });
});
