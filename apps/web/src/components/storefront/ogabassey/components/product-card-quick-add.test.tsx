import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProductCardQuickAdd } from './product-card-quick-add';

vi.mock('next/link', () => ({
  default: (
    props: { children: React.ReactNode; href: string } & Record<string, unknown>
  ) => {
    const { children, prefetch: _prefetch, ...anchorProps } = props;

    return <a {...anchorProps}>{children}</a>;
  },
}));

const base = {
  handleCartClick: vi.fn(),
  isAdded: false,
  productHref: '/playstation-5/playstation-5-pro',
  productName: 'PlayStation 5 Pro',
  requiresSelection: false,
  showPlusOne: false,
};

describe('ProductCardQuickAdd', () => {
  it('adds on tap and stays quiet until something is added', () => {
    const handleCartClick = vi.fn();
    render(<ProductCardQuickAdd {...base} handleCartClick={handleCartClick} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Add PlayStation 5 Pro to cart' })
    );

    expect(handleCartClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByText('Added to cart')).not.toBeInTheDocument();
  });

  it('confirms the add visibly and to screen readers, and stays repeatable', () => {
    render(<ProductCardQuickAdd {...base} isAdded />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'PlayStation 5 Pro added to cart'
    );
    expect(screen.getByText('Added to cart')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add another PlayStation 5 Pro to cart' })
    ).toBeEnabled();
  });

  it('links to the product page when a choice is needed', () => {
    render(<ProductCardQuickAdd {...base} isAdded requiresSelection />);

    expect(
      screen.getByRole('link', { name: 'Choose options for PlayStation 5 Pro' })
    ).toHaveAttribute('href', '/playstation-5/playstation-5-pro');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
