import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenSavedOrderSummary } from './OxygenSavedOrderSummary';

it('shows saved products and totals without duplicating customer details', () => {
  render(
    <OxygenSavedOrderSummary
      order={{
        id: 'order',
        customer_name: 'Ada',
        customer_email: 'ada@example.com',
        currency: 'NGN',
        subtotal: 100,
        shipping_fee: 10,
        tax_amount: 5,
        total: 115,
        wallet_amount_used: 0,
        order_items: [
          {
            id: 'line',
            name: 'Camera',
            quantity: 1,
            price: 100,
            image_url: null,
            products: null,
          },
        ],
      }}
    />
  );
  expect(screen.getByRole('img', { name: 'Camera' })).toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: 'Saved order summary' })
  ).toHaveTextContent('₦115.00');
  expect(screen.queryByText(/ada@example.com/)).not.toBeInTheDocument();
});
