import { render, screen } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';
import { ProductOwnershipLinks } from './product-ownership-links';

describe('ProductOwnershipLinks', () => {
  it.each([
    '/cart',
    '/ogabassey/cart',
  ] as const)('keeps wallet links in the storefront for %s', (cartHref) => {
    render(<ProductOwnershipLinks cartHref={cartHref as Route} />);
    expect(
      screen.getByRole('link', { name: 'Open your wallet ↗', hidden: true })
    ).toHaveAttribute('href', cartHref.replace('/cart', '/wallet'));
    expect(
      screen.getByText(/Eligibility, fees and repayment terms/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/interest|25%|40%/)).toBeNull();
  });
});
