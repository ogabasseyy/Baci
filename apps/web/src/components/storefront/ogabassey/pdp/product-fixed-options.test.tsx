import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductFixedOptions } from './product-fixed-options';

describe('ProductFixedOptions', () => {
  it('shows catalog configuration facts without creating fake selectable options', () => {
    render(
      <ProductFixedOptions
        variants={[
          {
            id: 'a',
            product_id: 'product-id',
            merchant_id: 'merchant-id',
            attributes: { ram: '6GB', storage: '128GB' },
            price_override: 100,
            stock_quantity: 2,
          },
        ]}
        selectableAxes={[]}
      />
    );
    expect(screen.getByText('6GB')).toBeVisible();
    expect(screen.getByText('128GB')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('does not duplicate selectors or choose one value from multiple variants', () => {
    const { container } = render(
      <ProductFixedOptions
        variants={[
          {
            id: 'a',
            product_id: 'product-id',
            merchant_id: 'merchant-id',
            attributes: { ram: '6GB', storage: '128GB' },
            price_override: 100,
            stock_quantity: 2,
          },
          {
            id: 'b',
            product_id: 'product-id',
            merchant_id: 'merchant-id',
            attributes: { ram: '8GB', storage: '128GB' },
            price_override: 150,
            stock_quantity: 2,
          },
        ]}
        selectableAxes={['storage']}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
