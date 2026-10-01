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
    const onViewCart = vi.fn();
    const { rerender } = render(<ProductCard product={product} isInCart={false} onAddToCart={onAddToCart} onViewCart={vi.fn()} />);
    fireEvent.error(screen.getByRole('img', { name: 'Redmi' }));
    expect(screen.queryByRole('img', { name: 'Redmi' })).toBeNull();
    expect(screen.getByText('-10%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(onAddToCart).toHaveBeenCalledWith(product);
    rerender(<ProductCard product={product} isInCart onAddToCart={onAddToCart} onViewCart={onViewCart} />);
    expect(screen.getByRole('button', { name: 'View cart' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'View cart' }));
    expect(onViewCart).toHaveBeenCalledOnce();
    expect(onAddToCart).toHaveBeenCalledOnce();
  });

  it('opens the product page through ChatGPT when available', () => {
    const openExternal = vi.fn();
    window.openai = { openExternal };
    render(<ProductCard product={product} isInCart={false} onAddToCart={vi.fn()} onViewCart={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review on Ogabassey' }));
    expect(openExternal).toHaveBeenCalledWith({ href: 'https://ogabassey.com/products/redmi' });
  });

  it('disables shopping-link preparation for confirmed sold-out products', () => {
    const onAddToCart = vi.fn();
    render(<ProductCard product={{ ...product, in_stock: false, stock_level: 'Out of Stock' }} isInCart={false} onAddToCart={onAddToCart} onViewCart={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Out of Stock' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onAddToCart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Review on Ogabassey' })).toBeEnabled();
  });

  it('opens a browser tab when the ChatGPT navigation API is absent', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<ProductCard product={product} isInCart={false} onAddToCart={vi.fn()} onViewCart={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review on Ogabassey' }));
    expect(open).toHaveBeenCalledWith('https://ogabassey.com/products/redmi', '_blank');
    open.mockRestore();
  });
  it.each([null, ''])('uses the product ID when the slug is %s', (slug) => {
    const openExternal = vi.fn();
    window.openai = { openExternal };
    render(<ProductCard product={{ ...product, id: 'phone/id', slug }} isInCart={false} onAddToCart={vi.fn()} onViewCart={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review on Ogabassey' }));
    expect(openExternal).toHaveBeenCalledWith({ href: 'https://ogabassey.com/products/phone%2Fid' });
  });

});
