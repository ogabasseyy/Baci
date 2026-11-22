import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PilotWalletForm } from './pilot-wallet-form';

const runPilotWalletAction = vi.hoisted(() => vi.fn());
vi.mock('./pilot-wallet-action', () => ({ runPilotWalletAction }));

it('requires the US region only after the pilot price is shown', async () => {
  runPilotWalletAction.mockResolvedValue({
    status: 'quote',
    token: 'fixture-token',
    totalKobo: 1673573,
    expiresAt: Date.now() + 55_000,
  });
  render(<PilotWalletForm />);
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Get pilot price' }));
  expect(
    await screen.findByRole('checkbox', { name: /United States/i })
  ).toBeRequired();
  expect(
    screen.getByRole('button', { name: 'Confirm wallet payment' })
  ).toBeInTheDocument();
});
