import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminMerchantHealthRow } from '@/types/admin-merchants';
import { MerchantDirectoryCard } from './merchant-directory-card';

const merchantTable = vi.fn((_props: unknown) => <div>Merchant table</div>);

vi.mock('./merchant-table', () => ({
  MerchantTable: (props: unknown) => merchantTable(props),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: ReactNode;
    onValueChange: (value: string) => void;
    value: string;
  }) => (
    <select
      aria-label="mock select"
      onChange={(event) => onValueChange(event.target.value)}
      value={value}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children, ...props }: ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: () => null,
}));

const merchant: AdminMerchantHealthRow = {
  active_days: 3,
  business_name: 'Baci Store',
  email: 'owner@example.com',
  excluded_non_ngn_or_unknown_paid_orders: 0,
  health_status: 'healthy',
  joined_at: '2026-06-01T00:00:00.000Z',
  last_order_date: '2026-06-02',
  merchant_id: 'merchant-1',
  storefront_slug: 'baci-store',
  total_gmv: 1_000,
  total_orders: 2,
};

function renderCard(
  overrides: Partial<ComponentProps<typeof MerchantDirectoryCard>> = {}
) {
  const props: ComponentProps<typeof MerchantDirectoryCard> = {
    filteredMerchants: [merchant],
    healthFilter: 'all',
    loading: false,
    onHealthFilterChange: vi.fn(),
    onInvalidStorefrontUrl: vi.fn(),
    onSearchQueryChange: vi.fn(),
    onSortByChange: vi.fn(),
    searchQuery: '',
    sortBy: 'gmv',
    ...overrides,
  };
  const view = render(<MerchantDirectoryCard {...props} />);
  return { ...view, props };
}

describe('MerchantDirectoryCard', () => {
  it('forwards search, accepted activity filters, sorting, and merchants to the directory table', () => {
    const { props } = renderCard();

    expect(screen.getByText('Highest NGN Paid GMV')).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText('Search merchants...'), {
      target: { value: 'baci' },
    });
    fireEvent.change(screen.getAllByLabelText('mock select')[0], {
      target: { value: 'at_risk' },
    });
    fireEvent.change(screen.getAllByLabelText('mock select')[1], {
      target: { value: 'joined' },
    });

    expect(props.onSearchQueryChange).toHaveBeenCalledWith('baci');
    expect(props.onHealthFilterChange).toHaveBeenCalledWith('at_risk');
    expect(props.onSortByChange).toHaveBeenCalledWith('joined');
    expect(merchantTable).toHaveBeenCalledWith({
      merchants: [merchant],
      onInvalidStorefrontUrl: props.onInvalidStorefrontUrl,
    });
  });

  it('does not forward invalid activity filter values', () => {
    const { props } = renderCard();

    fireEvent.change(screen.getAllByLabelText('mock select')[0], {
      target: { value: 'invalid' },
    });

    expect(props.onHealthFilterChange).not.toHaveBeenCalled();
  });

  it('shows transient loading rows instead of stale merchant results', () => {
    const { container } = renderCard({ loading: true });

    expect(screen.queryByText('Merchant table')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[class*="animate-pulse"]')).toHaveLength(
      15
    );
  });

  it('distinguishes an unfiltered empty directory from an empty filtered result', () => {
    const { rerender } = render(
      <MerchantDirectoryCard
        filteredMerchants={[]}
        healthFilter="all"
        loading={false}
        onHealthFilterChange={vi.fn()}
        onInvalidStorefrontUrl={vi.fn()}
        onSearchQueryChange={vi.fn()}
        onSortByChange={vi.fn()}
        searchQuery=""
        sortBy="gmv"
      />
    );

    expect(
      screen.getByText('Merchants will appear here once they sign up')
    ).toBeVisible();

    rerender(
      <MerchantDirectoryCard
        filteredMerchants={[]}
        healthFilter="healthy"
        loading={false}
        onHealthFilterChange={vi.fn()}
        onInvalidStorefrontUrl={vi.fn()}
        onSearchQueryChange={vi.fn()}
        onSortByChange={vi.fn()}
        searchQuery=""
        sortBy="gmv"
      />
    );

    expect(screen.getByText('Try adjusting your filters')).toBeVisible();
  });
});
