import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OwnershipCompare } from './ownership-compare';

vi.mock('./ownership-dialog', () => {
  throw new Error('Simulated chunk download failure');
});

it('keeps the comparison trigger usable and explains a failed chunk load', async () => {
  render(<OwnershipCompare />);
  const trigger = screen.getByRole('button', { name: 'Compare ways to own' });
  fireEvent.click(trigger);
  expect(
    await screen.findByText(/Comparison couldn’t load/)
  ).toBeInTheDocument();
  expect(trigger).toBeEnabled();
  expect(trigger).not.toHaveAttribute('aria-busy');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
