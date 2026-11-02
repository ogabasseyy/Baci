import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => (
    <a {...props}>{children}</a>
  ),
}));

import { OrderSuccessNavigationLink } from './order-success-navigation-link';

it('uses merchant primary and contrasting text tokens for primary actions', () => {
  render(
    <OrderSuccessNavigationLink href="/checkout" primary>
      Return to Checkout
    </OrderSuccessNavigationLink>
  );
  expect(screen.getByRole('link')).toHaveClass(
    'bg-store-primary',
    'text-store-primary-text'
  );
});
