import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('./oxygen-payment-content', () => ({
  OxygenPaymentContent: () => {
    throw new Promise(() => {});
  },
}));

import OxygenPaymentPage from './page';

it('streams a private payment-plan loading boundary while request data is pending', () => {
  render(<OxygenPaymentPage params={new Promise(() => {})} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading payment plan');
});
