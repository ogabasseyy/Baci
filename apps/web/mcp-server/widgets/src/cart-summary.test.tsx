import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CartSummary } from './cart-summary';

describe('CartSummary', () => {
  it('does not offer checkout for an empty cart', () => {
    const { container } = render(<CartSummary cart={[]} canReview={false} onViewCart={vi.fn()} onRemoveItem={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps Review reachable for a foreign-only cart', () => {
    const onViewCart = vi.fn();
    render(<CartSummary cart={[]} canReview onViewCart={onViewCart} onRemoveItem={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Review Cart on Ogabassey/ }));
    expect(onViewCart).toHaveBeenCalledOnce();
  });

  it('shows totals and sends removal and review actions to the caller', () => {
    const onRemoveItem = vi.fn();
    const onViewCart = vi.fn();
    render(<CartSummary
      cart={[{ product: { id: 'phone-1', name: 'Redmi', slug: 'redmi', price: 128000 }, quantity: 2 }]}
      canReview
      onViewCart={onViewCart}
      onRemoveItem={onRemoveItem}
    />);
    expect(screen.getByText('2 items')).toBeInTheDocument();
    expect(screen.getByText(/256,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Redmi' }));
    fireEvent.click(screen.getByRole('button', { name: /Review Cart on Ogabassey/ }));
    expect(onRemoveItem).toHaveBeenCalledWith('phone-1');
    expect(onViewCart).toHaveBeenCalledOnce();
  });
});
