import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminMerchantHealthRow } from '@/types/admin-merchants';
import { MerchantTable } from './merchant-table';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: ComponentProps<'a'>) => (
    <a href={href?.toString() ?? '#'} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    asChild,
    children,
    disabled,
    onClick,
  }: {
    asChild?: boolean;
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) =>
    asChild ? (
      children
    ) : (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

const merchant: AdminMerchantHealthRow = {
  active_days: 12,
  business_name: 'Baci Store',
  email: 'owner@example.com',
  health_status: 'healthy',
  joined_at: '2026-03-20T10:00:00.000Z',
  last_order_date: '2026-03-24',
  merchant_id: '11111111-1111-4111-8111-111111111111',
  storefront_slug: 'baci-store',
  total_gmv: 1200,
  total_orders: 4,
  excluded_non_ngn_or_unknown_paid_orders: 2,
};

describe('MerchantTable', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders paid-sales activity, metrics, dates, and directory links', () => {
    render(
      <MerchantTable merchants={[merchant]} onInvalidStorefrontUrl={vi.fn()} />
    );

    expect(screen.getByRole('link', { name: 'Baci Store' })).toHaveAttribute(
      'href',
      '/admin/merchants/11111111-1111-4111-8111-111111111111'
    );
    expect(screen.getByText('owner@example.com')).toBeVisible();
    expect(screen.getByText('Selling')).toBeVisible();
    expect(screen.getByText('₦1.2K')).toBeVisible();
    expect(
      screen.getByText('2 non-NGN/unknown paid order(s) excluded')
    ).toBeVisible();
    expect(screen.getByText('4')).toBeVisible();
    expect(screen.getByText('Mar 24, 2026')).toBeVisible();
    expect(screen.getByText('Mar 20, 2026')).toBeVisible();
    expect(screen.getByText('View Merchant 360')).toBeVisible();
    expect(screen.queryByText('View merchant users')).not.toBeInTheDocument();
  });

  it('renders an empty table state when there are no merchants', () => {
    render(<MerchantTable merchants={[]} onInvalidStorefrontUrl={vi.fn()} />);

    expect(screen.getByText('No merchants found')).toBeVisible();
  });

  it('uses mailto links and opens the canonical storefront slug', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <MerchantTable merchants={[merchant]} onInvalidStorefrontUrl={vi.fn()} />
    );

    expect(screen.getByRole('link', { name: /send email/i })).toHaveAttribute(
      'href',
      'mailto:owner@example.com'
    );

    fireEvent.click(screen.getByRole('button', { name: /view store/i }));

    expect(openSpy).toHaveBeenCalledWith(
      '/baci-store',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('falls back to the generated business slug when the canonical slug is unavailable', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <MerchantTable
        merchants={[{ ...merchant, storefront_slug: null }]}
        onInvalidStorefrontUrl={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /view store/i }));

    expect(openSpy).toHaveBeenCalledWith(
      '/baci-store',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('disables email and reports invalid storefront links when no identifier can be built', () => {
    const onInvalidStorefrontUrl = vi.fn();
    const invalidMerchant: AdminMerchantHealthRow = {
      ...merchant,
      business_name: null,
      email: null,
      merchant_id: '',
      storefront_slug: null,
    };

    render(
      <MerchantTable
        merchants={[invalidMerchant]}
        onInvalidStorefrontUrl={onInvalidStorefrontUrl}
      />
    );

    expect(screen.getByRole('button', { name: /send email/i })).toBeDisabled();
    expect(screen.getByText('No email')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /view store/i }));

    expect(onInvalidStorefrontUrl).toHaveBeenCalledTimes(1);
  });

  it('reports invalid storefront links instead of falling back to merchant UUIDs', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onInvalidStorefrontUrl = vi.fn();

    render(
      <MerchantTable
        merchants={[
          {
            ...merchant,
            business_name: null,
            storefront_slug: null,
          },
        ]}
        onInvalidStorefrontUrl={onInvalidStorefrontUrl}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /view store/i }));

    expect(openSpy).not.toHaveBeenCalled();
    expect(onInvalidStorefrontUrl).toHaveBeenCalledTimes(1);
  });

  it('disables email while preserving storefront links when only email is missing', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onInvalidStorefrontUrl = vi.fn();

    render(
      <MerchantTable
        merchants={[{ ...merchant, email: null }]}
        onInvalidStorefrontUrl={onInvalidStorefrontUrl}
      />
    );

    expect(screen.getByRole('button', { name: /send email/i })).toBeDisabled();
    expect(screen.getByText('No email')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /view store/i }));

    expect(onInvalidStorefrontUrl).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(
      '/baci-store',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('keeps email actions enabled and reports invalid storefront links when only merchant id is missing', () => {
    const onInvalidStorefrontUrl = vi.fn();

    render(
      <MerchantTable
        merchants={[
          {
            ...merchant,
            business_name: null,
            merchant_id: null as unknown as string,
            storefront_slug: null,
          },
        ]}
        onInvalidStorefrontUrl={onInvalidStorefrontUrl}
      />
    );

    expect(screen.getByRole('link', { name: /send email/i })).toHaveAttribute(
      'href',
      'mailto:owner@example.com'
    );

    fireEvent.click(screen.getByRole('button', { name: /view store/i }));

    expect(onInvalidStorefrontUrl).toHaveBeenCalledTimes(1);
  });
});
