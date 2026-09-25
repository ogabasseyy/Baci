import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductCard } from './product-card';

const product = {
  id: 'phone-1', name: 'Redmi', slug: 'redmi', price: 90000,
  compare_at_price: 100000, image: 'https://mcp.ogabassey.com/images/redmi.webp',
};

afterEach(() => { delete window.openai; });

describe('ProductCard', () => {
  it('falls back to an image placeholder and prepares only one link', () => {
    const onAddToCart = vi.fn();
    const { rerender } = render(<ProductCard product={product} isInCart={false} onAddToCart={onAddToCart} />);
    fireEvent.error(screen.getByRole('img', { name: 'Redmi' }));
    expect(screen.queryByRole('img', { name: 'Redmi' })).toBeNull();
    expect(screen.getByText('-10%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Shopping Link' }));
    expect(onAddToCart).toHaveBeenCalledWith(product);
    rerender(<ProductCard product={product} isInCart onAddToCart={onAddToCart} />);
    expect(screen.getByRole('button', { name: 'Link Ready' })).toBeDisabled();
  });

  it('opens the product page through ChatGPT when available', () => {
    const openExternal = vi.fn();
    window.openai = { openExternal };
    render(<ProductCard product={product} isInCart={false} onAddToCart={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review on Ogabassey' }));
    expect(openExternal).toHaveBeenCalledWith({ href: 'https://ogabassey.com/products/redmi' });
  });

  it('opens a browser tab when the ChatGPT navigation API is absent', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<ProductCard product={product} isInCart={false} onAddToCart={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review on Ogabassey' }));
    expect(open).toHaveBeenCalledWith('https://ogabassey.com/products/redmi', '_blank');
    open.mockRestore();
  });
});
