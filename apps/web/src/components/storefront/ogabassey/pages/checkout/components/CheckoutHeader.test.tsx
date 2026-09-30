import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutHeader } from './CheckoutHeader';

describe('CheckoutHeader', () => {
  it('renders the secure navigation and sends Return to Cart through its callback', () => {
    const onReturnToCart = vi.fn();

    render(<CheckoutHeader onReturnToCart={onReturnToCart} />);

    expect(screen.getByText('Secure Checkout')).toBeInTheDocument();
    expect(screen.getByText('Encrypted')).toBeInTheDocument();
    const returnButton = screen.getByRole('button', { name: 'Return to Cart' });
    expect(returnButton).toHaveAttribute('aria-label', 'Return to Cart');
    fireEvent.click(returnButton);

    expect(onReturnToCart).toHaveBeenCalledOnce();
  });
});
