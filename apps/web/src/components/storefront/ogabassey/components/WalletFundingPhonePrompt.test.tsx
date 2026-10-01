import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WalletFundingPhonePrompt } from './WalletFundingPhonePrompt';

describe('WalletFundingPhonePrompt', () => {
  it('rejects an invalid Nigerian phone without saving it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<WalletFundingPhonePrompt onSubmit={onSubmit} />);

    await user.type(
      screen.getByRole('textbox', { name: /phone number/i }),
      '12345'
    );
    await user.click(screen.getByRole('button', { name: /save and continue/i }));

    expect(
      screen.getByText(/valid Nigerian phone number/i)
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('saves a valid phone and leaves provider account creation to the caller', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ success: true });

    render(<WalletFundingPhonePrompt onSubmit={onSubmit} />);

    await user.type(
      screen.getByRole('textbox', { name: /phone number/i }),
      '08012345678'
    );
    await user.click(screen.getByRole('button', { name: /save and continue/i }));

    expect(onSubmit).toHaveBeenCalledWith('08012345678');
  });

  it('displays a persistence error when saving a valid phone fails', async () => {
    const user = userEvent.setup();
    const errorMessage = 'Phone number could not be saved';
    const onSubmit = vi.fn().mockResolvedValue({
      error: errorMessage,
      success: false,
    });

    render(<WalletFundingPhonePrompt onSubmit={onSubmit} />);

    await user.type(
      screen.getByRole('textbox', { name: /phone number/i }),
      '08012345678'
    );
    await user.click(screen.getByRole('button', { name: /save and continue/i }));

    expect(await screen.findByText(errorMessage)).toBeInTheDocument();
  });
});
