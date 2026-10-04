import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ArchiveOrderCard } from '@/app/(storefront)/[slug]/(customer)/receipts/archive-order-card';
import type { StorefrontOrder } from '@/types/storefront-order';

vi.mock('next/link', () => ({
  default: vi.fn(
    ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  ),
}));

function createOrder(overrides: Partial<StorefrontOrder> = {}): StorefrontOrder {
  return {
    id: 'order-1',
    order_number: 'ORD-100',
    current_document_kind: 'receipt',
    invoice_type_code: null,
    items: [{ product_name: 'Test Phone', quantity: 1, price: 150000 }],
    total: 150000,
    currency: 'NGN',
    shipping_status: 'delivered',
    created_at: '2024-02-05T10:00:00.000Z',
    transaction_date: null,
    invoice_issue_date: null,
    ...overrides,
  } as StorefrontOrder;
}

describe('ArchiveOrderCard', () => {
  it('renders the order number, badge kind, and total', () => {
    render(
      <ArchiveOrderCard
        order={createOrder()}
        merchantSlug="shop"
        getHref={(path) => `/shop${path}`}
      />
    );

    expect(screen.getByText('#ORD-100')).toBeDefined();
    expect(screen.getByText('receipt')).toBeDefined();
    expect(screen.getByText(/150,000/)).toBeDefined();
  });

  it('links the download to the current document kind with a kind label', () => {
    render(
      <ArchiveOrderCard
        order={createOrder({
          current_document_kind: 'invoice',
          invoice_type_code: '325',
        })}
        merchantSlug="shop"
        getHref={(path) => `/shop${path}`}
      />
    );

    // Badge + CTA say proforma for 325 orders, but the href still uses
    // the current document kind the download route expects.
    expect(screen.getByText('proforma')).toBeDefined();
    const download = screen.getByText(/Download Proforma Invoice/).closest('a');
    expect(download?.getAttribute('href')).toBe(
      '/api/storefront/account/orders/order-1/invoice?merchantSlug=shop'
    );
    const viewOrder = screen.getByText('View Order').closest('a');
    expect(viewOrder?.getAttribute('href')).toBe('/shop/account/orders/order-1');
  });
});
