import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutReconciliationView } from './checkout-reconciliation-view';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_target, tag: string) =>
        ({ children, ...props }: { children?: React.ReactNode }) => {
          const Tag = tag as 'div';
          return <Tag {...props}>{children}</Tag>;
        },
    }
  ),
}));

describe('CheckoutReconciliationView', () => {
  const getHref = (path: string) => `/test-store${path}`;

  it('presents the under-review state with the order number', () => {
    render(
      <CheckoutReconciliationView orderNumber="BAC-42" getHref={getHref} />
    );

    expect(
      screen.getByRole('heading', {
        name: 'Payment Received — Order Under Review',
      })
    ).toBeInTheDocument();
    expect(screen.getByText('#BAC-42')).toBeInTheDocument();
    expect(screen.getByText(/Your cart is still intact/)).toBeInTheDocument();
  });

  it('omits the order number line when unknown', () => {
    render(<CheckoutReconciliationView orderNumber={null} getHref={getHref} />);

    expect(
      screen.getByRole('heading', {
        name: 'Payment Received — Order Under Review',
      })
    ).toBeInTheDocument();
    expect(screen.queryByText(/^#/)).not.toBeInTheDocument();
  });

  it('links to order tracking and support', () => {
    render(
      <CheckoutReconciliationView orderNumber="BAC-42" getHref={getHref} />
    );

    expect(
      screen.getByRole('link', { name: /Track Order Status/ })
    ).toHaveAttribute('href', '/test-store/account/orders');
    expect(
      screen.getByRole('link', { name: /Contact our support team/ })
    ).toHaveAttribute('href', '/test-store/contact');
  });

  it('never presents a confirmed-order message', () => {
    const { container } = render(
      <CheckoutReconciliationView orderNumber="BAC-42" getHref={getHref} />
    );

    expect(container.textContent).not.toMatch(
      /order (confirmed|placed|successful)/i
    );
  });

  it('renders in storefront theme tokens, never a hardcoded palette', () => {
    const { container } = render(
      <CheckoutReconciliationView orderNumber="BAC-42" getHref={getHref} />
    );

    // Merchant palettes and dark-mode storefronts flow through the
    // --store-* tokens; raw amber/gray/white/black utilities would pin
    // this state to the default brand.
    const classes = container.innerHTML;
    expect(classes).toMatch(/store-(primary|secondary|background|border)/);
    expect(classes).not.toMatch(
      /amber-\d+|gray-\d+|bg-white|text-white|bg-black/
    );
  });
});
