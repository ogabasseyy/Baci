import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WalletFundingNamePrompt } from './WalletFundingNamePrompt';

describe('WalletFundingNamePrompt', () => {
  it('trims and persists both required names', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ success: true });

    render(
      <WalletFundingNamePrompt
        initialFirstName="  Jane "
        initialLastName=" Doe "
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByRole('button', { name: /save and continue/i }));

    expect(onSubmit).toHaveBeenCalledWith('Jane', 'Doe');
  });

  it('requires both names before submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<WalletFundingNamePrompt onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: /save and continue/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/both your first and last name/i)).toBeInTheDocument();
  });
});
