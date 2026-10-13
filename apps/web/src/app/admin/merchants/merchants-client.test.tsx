import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AdminMerchantHealthRow,
  AdminMerchantsResponse,
} from '@/types/admin-merchants';
import type { HealthFilter } from './merchant-health-filter';

const mockApiGet = vi.fn();
const mockToast = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('./merchant-directory-card', () => ({
  MerchantDirectoryCard: ({
    filteredMerchants,
    healthFilter,
    loading,
    onHealthFilterChange,
    onSearchQueryChange,
    onSortByChange,
    searchQuery,
    sortBy,
  }: {
    filteredMerchants: AdminMerchantHealthRow[];
    healthFilter: HealthFilter;
    loading: boolean;
    onHealthFilterChange: (filter: HealthFilter) => void;
    onSearchQueryChange: (search: string) => void;
    onSortByChange: (sortBy: string) => void;
    searchQuery: string;
    sortBy: string;
  }) => (
    <div>
      <p>rows:{filteredMerchants.length}</p>
      <p>health:{healthFilter}</p>
      <p>loading:{String(loading)}</p>
      <p>sort:{sortBy}</p>
      <input
        aria-label="Search merchants"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
      />
      <button type="button" onClick={() => onHealthFilterChange('at_risk')}>
        Filter at risk
      </button>
      <button type="button" onClick={() => onSortByChange('orders')}>
        Sort by orders
      </button>
    </div>
  ),
}));

import { MerchantsClient } from './merchants-client';

const merchantRows: AdminMerchantHealthRow[] = [
  {
    active_days: 10,
    business_name: 'Baci Store',
    email: 'owner@example.com',
    excluded_non_ngn_or_unknown_paid_orders: 2,
    health_status: 'healthy',
    joined_at: '2026-03-20T10:00:00.000Z',
    last_order_date: '2026-03-24',
    merchant_id: 'merchant-1',
    total_gmv: 1200,
    total_orders: 12,
  },
];

function merchantResponse(
  total = merchantRows.length,
  offset = 0
): AdminMerchantsResponse {
  return {
    data: merchantRows,
    generatedAt: '2026-08-05T10:00:00.000Z',
    pagination: { limit: 50, offset, total },
  };
}

describe('MerchantsClient', () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue(merchantResponse());
    mockToast.mockReset();
  });

  it('requests server-backed health, search, and sort filters', async () => {
    const user = userEvent.setup();
    render(<MerchantsClient initialMerchants={merchantRows} />);

    await user.click(screen.getByRole('button', { name: 'Filter at risk' }));
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenLastCalledWith(
        '/api/admin/merchants?health=at_risk&limit=50&offset=0&sortBy=gmv'
      );
    });

    await user.click(screen.getByRole('button', { name: 'Sort by orders' }));
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenLastCalledWith(
        '/api/admin/merchants?health=at_risk&limit=50&offset=0&sortBy=orders'
      );
    });
  });

  it('debounces search input into one deterministic server request', async () => {
    const user = userEvent.setup();
    render(<MerchantsClient initialMerchants={merchantRows} />);

    await user.type(
      screen.getByRole('textbox', { name: 'Search merchants' }),
      'quiet store'
    );

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledTimes(1);
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/admin/merchants?health=all&limit=50&offset=0&sortBy=gmv&search=quiet+store'
      );
    });
  });

  it('shows a generic failure state when the server-backed request fails', async () => {
    const user = userEvent.setup();
    mockApiGet.mockRejectedValue(new Error('network failed'));
    render(<MerchantsClient initialMerchants={merchantRows} />);

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Merchant data could not load.'
      );
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Failed to load merchant data.',
        variant: 'destructive',
      })
    );
  });

  it('requests the final valid page and disables Next at the directory cap', async () => {
    const user = userEvent.setup();
    mockApiGet.mockResolvedValue(merchantResponse(10_100, 10_000));
    render(
      <MerchantsClient
        initialMerchants={merchantRows}
        initialQuery={{
          health: 'all',
          limit: 50,
          offset: 9_950,
          search: undefined,
          sortBy: 'gmv',
        }}
        initialTotal={10_100}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenLastCalledWith(
        '/api/admin/merchants?health=all&limit=50&offset=10000&sortBy=gmv'
      );
    });

    expect(
      screen.getByText(/configured 10,000-row merchant directory boundary/i)
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(mockApiGet).toHaveBeenCalledTimes(1);
  });
});
