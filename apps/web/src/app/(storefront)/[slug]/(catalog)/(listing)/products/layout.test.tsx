import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ProductsLayout from './layout';

describe('products layout', () => {
  it('eagerly styles the products index instead of waiting for first input', () => {
    render(
      <ProductsLayout>
        <main>Products</main>
      </ProductsLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Products');
  });
});
