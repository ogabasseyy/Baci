import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CheckoutStepCard } from './CheckoutStepCard';

it('renders the completed summary and lets the customer edit it', () => {
  const select = vi.fn();
  render(<CheckoutStepCard number={2} title="Delivery" complete summary="Pickup" onSelect={select}>Details</CheckoutStepCard>);
  expect(screen.getByText('Pickup')).toBeInTheDocument();
  expect(screen.getByText('Details')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Delivery.*Pickup.*Edit/ }));
  expect(select).toHaveBeenCalledOnce();
});

it('disables a locked step and does not offer edit without an action', () => {
  const select = vi.fn();
  const { rerender } = render(<CheckoutStepCard number={1} title="Identity" disabled onSelect={select} />);
  fireEvent.click(screen.getByRole('button', { name: /Identity/ }));
  expect(select).not.toHaveBeenCalled();
  rerender(<CheckoutStepCard number={1} title="Identity" complete />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByText('Edit')).not.toBeInTheDocument();
});
