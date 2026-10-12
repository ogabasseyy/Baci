import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UtilitySuccessView } from './UtilitySuccessView';

describe('UtilitySuccessView', () => {
  it('renders transaction details and closes the modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <UtilitySuccessView
        activeTab="airtime"
        amount={1500}
        onClose={onClose}
        reference="VTU-123"
      />
    );

    expect(screen.getByText('airtime')).toBeInTheDocument();
    expect(screen.getByText(/1,500/)).toBeInTheDocument();
    expect(screen.getByText('VTU-123')).toBeInTheDocument();

    const doneButton = screen.getByRole('button', { name: 'Done' });
    expect(doneButton).toHaveClass('bg-store-primary');

    await user.click(doneButton);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders the pending state while a purchase is processing', () => {
    render(
      <UtilitySuccessView
        activeTab="airtime"
        amount={1500}
        onClose={vi.fn()}
        processing={true}
        reference="VTU-123"
      />
    );

    expect(screen.getByText('Processing…')).toBeInTheDocument();
    expect(
      screen.getByText(/still fail or be refunded/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Success!')).not.toBeInTheDocument();
  });

  it('renders the prepaid voucher token when the vend returns one', () => {
    render(
      <UtilitySuccessView
        activeTab="electricity"
        amount={1000}
        onClose={vi.fn()}
        reference="VTU-456"
        voucherPin="1234-5678-9012"
      />
    );

    expect(screen.getByText('Voucher / Token')).toBeInTheDocument();
    expect(screen.getByText('1234-5678-9012')).toBeInTheDocument();
  });

  it('omits the voucher row when no token was returned', () => {
    render(
      <UtilitySuccessView
        activeTab="airtime"
        amount={500}
        onClose={vi.fn()}
        reference="VTU-789"
      />
    );

    expect(screen.queryByText('Voucher / Token')).not.toBeInTheDocument();
  });
});
