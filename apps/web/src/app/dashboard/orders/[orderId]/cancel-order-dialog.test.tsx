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
  it('defaults to refunding the original payment method and shows the amount', async () => {
    const { onConfirm } = setup();
    expect(
      screen.getByRole('radio', {
        name: /cancel and refund .*12,500.* to the customer's original payment method/i,
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

  it('starts from the automatic default when remounted with a new key', async () => {
    const props = {
      currency: 'NGN',
      isOpen: true,
      onClose: vi.fn(),
      onConfirm: vi.fn().mockResolvedValue(undefined),
      refundAmount: 12500,
    };
    const { rerender } = render(<CancelOrderDialog key="1" {...props} />);
    await userEvent.click(screen.getByRole('radio', { name: /cancel only/i }));
    rerender(<CancelOrderDialog key="2" {...props} />);
    expect(
      screen.getByRole('radio', { name: /cancel and refund/i })
    ).toBeChecked();
  });

  it('defaults to the review path, not self-refund, when a leg cannot be refunded automatically', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <CancelOrderDialog
        automaticSupported={false}
        currency="NGN"
        isOpen
        onClose={vi.fn()}
        onConfirm={onConfirm}
        refundAmount={12500}
      />
    );
    expect(
      screen.getByRole('radio', {
        name: /send the .*12,500.* refund to review/i,
      })
    ).toBeChecked();
    expect(
      screen.getByRole('radio', { name: /cancel only/i })
    ).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(onConfirm).toHaveBeenCalledWith('automatic');
  });

  it('hides cancel-only without refund permission', () => {
    render(
      <CancelOrderDialog
        canCancelOnly={false}
        currency="NGN"
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        refundAmount={12500}
      />
    );
    expect(
      screen.queryByRole('radio', { name: /cancel only/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /cancel and refund/i })
    ).toBeChecked();
  });

  it('lets staff without refund permission cancel and send the refund to review', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <CancelOrderDialog
        automaticSupported={false}
        canCancelOnly={false}
        currency="NGN"
        isOpen
        onClose={vi.fn()}
        onConfirm={onConfirm}
        refundAmount={12500}
      />
    );
    expect(
      screen.getByRole('radio', {
        name: /send the .*12,500.* refund to review/i,
      })
    ).toBeChecked();
    expect(
      screen.queryByRole('radio', { name: /cancel only/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/sent to the store owner for review/i)
    ).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(onConfirm).toHaveBeenCalledWith('automatic');
  });

  it('limits the cancel-only refund to the part not already in flight', async () => {
    render(
      <CancelOrderDialog
        currency="NGN"
        inFlightAmount={5000}
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        refundAmount={12500}
      />
    );
    expect(
      screen.getByRole('radio', { name: /refund the remaining .*12,500/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/already in progress with the provider/i)
    ).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: /cancel only/i }));
    expect(screen.getByText(/for the remaining .*12,500/i)).toBeVisible();
  });

  it('submits the automatic choice when cancel-only becomes unavailable after being selected', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const props = {
      currency: 'NGN',
      isOpen: true,
      onClose: vi.fn(),
      onConfirm,
      refundAmount: 12500,
    };
    const { rerender } = render(<CancelOrderDialog {...props} />);
    await userEvent.click(screen.getByRole('radio', { name: /cancel only/i }));
    rerender(<CancelOrderDialog {...props} canCancelOnly={false} />);
    expect(
      screen.getByRole('radio', { name: /cancel and refund/i })
    ).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(onConfirm).toHaveBeenCalledWith('automatic');
  });
});
