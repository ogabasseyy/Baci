import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OrderAmendmentDialog } from './order-amendment-dialog';

it('requires a searchable query and lets staff leave before confirmation', () => {
  const onClose = vi.fn();
  render(
    <OrderAmendmentDialog
      path="/api/orders/synthetic/amendments"
      items={[{ id: 'original', name: 'Original', quantity: 1, price: 5000 }]}
      currency="NGN"
      canRefund
      onClose={onClose}
      onConfirmed={vi.fn()}
      onConflict={vi.fn()}
      resolveConfirmation={vi.fn()}
    />
  );

  expect(
    screen.getByRole('heading', { name: 'Change items' })
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Find a replacement'), {
    target: { value: 'phone' },
  });
  expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
  fireEvent.click(screen.getByText('Close', { selector: 'button' }));
  expect(onClose).toHaveBeenCalledOnce();
});
