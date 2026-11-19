import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenProductSummary } from './OxygenProductSummary';

const products = [
  {
    id: 'phone',
    name: 'Saved phone',
    quantity: 2,
    price: 198000,
    imageUrl: 'https://cdn.example.com/phone.jpg',
  },
];
it('shows the persisted product image, name, quantity and extended price', () => {
  render(<OxygenProductSummary products={products} />);
  expect(screen.getByRole('img', { name: 'Saved phone' })).toHaveAttribute(
    'src',
    products[0].imageUrl
  );
  expect(screen.getByRole('region', { name: 'Your items' })).toHaveTextContent(
    'Qty 2 · ₦396,000.00'
  );
});
it('keeps long orders compact without hiding the remaining items permanently', () => {
  render(
    <OxygenProductSummary
      products={[
        ...products,
        { ...products[0], id: 'second', name: 'Charger' },
        { ...products[0], id: 'third', name: 'Case', imageUrl: undefined },
      ]}
    />
  );
  expect(screen.getByText('Case')).not.toBeVisible();
  fireEvent.click(screen.getByText('1 more items'));
  expect(screen.getByText('Case')).toBeVisible();
});
it('does not invent an image or an empty order summary', () => {
  const view = render(
    <OxygenProductSummary
      products={[{ ...products[0], imageUrl: 'javascript:alert(1)' }]}
    />
  );
  expect(screen.queryByRole('img')).toBeNull();
  view.rerender(<OxygenProductSummary products={[]} />);
  expect(screen.queryByRole('region')).toBeNull();
});
