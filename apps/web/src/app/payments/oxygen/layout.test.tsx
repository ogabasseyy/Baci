import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import OxygenPaymentLayout from './layout';

it('renders payment content inside the main landmark', () => {
  render(
    <OxygenPaymentLayout>
      <p>Payment status</p>
    </OxygenPaymentLayout>
  );
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  expect(screen.getByRole('main')).toHaveTextContent('Payment status');
});
