import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Route } from 'next';
import { OgabasseyPdpCriticalCommerceControls } from './critical-commerce-controls.client';

const mockState = {
  canAddToCart: true,
  handleAddToCart: vi.fn(),
  handleDecrementCartQuantity: vi.fn(),
  handleIncrementCartQuantity: vi.fn(),
  isAtMaxQuantity: false,
  isAtMinCartQuantity: false,
  productForCart: { id: 'p1', minimum_order_quantity: 1 },
  quantityInCart: 0,
};

vi.mock('./critical-commerce-state.client', () => ({
  useOgabasseyPdpCriticalCommerce: () => mockState,
}));

vi.mock('../pages/product-details-page/assurance-default-note', () => ({
  AssuranceDefaultNote: () => <div data-testid="assurance-note" />,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

describe('OgabasseyPdpCriticalCommerceControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.canAddToCart = true;
    mockState.quantityInCart = 0;
    mockState.isAtMaxQuantity = false;
    mockState.isAtMinCartQuantity = false;
  });

  it('renders Add to Cart button when not in cart', () => {
    render(
      <OgabasseyPdpCriticalCommerceControls
        cartHref={'/cart' as Route}
        productName="Google Pixel 9"
      />
    );

    const addBtn = screen.getByRole('button', { name: 'Add to cart' });
    expect(addBtn).toBeInTheDocument();
    expect(addBtn).toBeEnabled();
    expect(screen.getByTestId('assurance-note')).toBeInTheDocument();

    fireEvent.click(addBtn);
    expect(mockState.handleAddToCart).toHaveBeenCalledTimes(1);
  });

  it('disables Add to Cart button when canAddToCart is false', () => {
    mockState.canAddToCart = false;

    render(
      <OgabasseyPdpCriticalCommerceControls
        cartHref={'/cart' as Route}
        productName="Google Pixel 9"
      />
    );

    const addBtn = screen.getByRole('button', { name: 'Add to cart' });
    expect(addBtn).toBeDisabled();
  });

  it('renders stepper and View Cart link when quantityInCart > 0', () => {
    mockState.quantityInCart = 2;

    render(
      <OgabasseyPdpCriticalCommerceControls
        cartHref={'/cart' as Route}
        productName="Google Pixel 9"
      />
    );

    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument();
    expect(screen.getByText('In Cart')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    const viewCartLink = screen.getByRole('link', { name: /view cart/i });
    expect(viewCartLink).toHaveAttribute('href', '/cart');

    const incBtn = screen.getByLabelText('Increase quantity for Google Pixel 9');
    fireEvent.click(incBtn);
    expect(mockState.handleIncrementCartQuantity).toHaveBeenCalledTimes(1);

    const decBtn = screen.getByLabelText('Decrease quantity for Google Pixel 9');
    fireEvent.click(decBtn);
    expect(mockState.handleDecrementCartQuantity).toHaveBeenCalledTimes(1);
  });

  it('shows remove label when decrementing at minimum quantity', () => {
    mockState.quantityInCart = 1;
    mockState.isAtMinCartQuantity = true;

    render(
      <OgabasseyPdpCriticalCommerceControls
        cartHref={'/cart' as Route}
        productName="Google Pixel 9"
      />
    );

    const removeBtn = screen.getByLabelText('Remove Google Pixel 9 from cart');
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn);
    expect(mockState.handleDecrementCartQuantity).toHaveBeenCalledTimes(1);
  });
});
