import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CheckoutStepSection } from './CheckoutStepSection';

const props = {
  id: 'step',
  title: 'Payment',
  number: 3,
  completed: false,
  onOpen: vi.fn(),
  children: <button type="button">Pay</button>,
};
it('does not steal focus when persisted state activates a step during hydration', () => {
  const { rerender } = render(
    <CheckoutStepSection {...props} active={false} />
  );
  rerender(<CheckoutStepSection {...props} active />);
  expect(screen.getByRole('button', { name: 'Payment' })).not.toHaveFocus();
});
it('focuses the heading when the parent requests focus for a step transition', () => {
  const { rerender } = render(
    <CheckoutStepSection {...props} active={false} />
  );
  rerender(<CheckoutStepSection {...props} active focusOnActivate />);
  expect(screen.getByRole('button', { name: 'Payment' })).toHaveFocus();
});
