import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CancelOrderDialog } from './cancel-order-dialog';

function setup() {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(
    <CancelOrderDialog
      currency="NGN"
      isOpen
      onClose={vi.fn()}
      onConfirm={onConfirm}
      refundAmount={12500}
    />
  );
  return { onConfirm };
}

describe('CancelOrderDialog', () => {
  it('defaults to refunding via Paystack and shows the amount', async () => {
    const { onConfirm } = setup();
    expect(
      screen.getByRole('radio', {
        name: /cancel and refund .*12,500.* to the customer via paystack/i,
      })
    ).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(onConfirm).toHaveBeenCalledWith('automatic');
  });

  it('confirms a cancel-only choice and explains the pending refund', async () => {
    const { onConfirm } = setup();
    await userEvent.click(screen.getByRole('radio', { name: /cancel only/i }));
    expect(
      screen.getByText(/no refund will be sent automatically/i)
    ).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(onConfirm).toHaveBeenCalledWith('manual');
  });
});
