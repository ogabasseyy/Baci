'use client';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockApiGet = vi.fn();
const mockToast = vi.fn();
const mockCreateClient = vi.fn();
const mockGetAdminMerchantHealthPage = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: ComponentProps<'a'>) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/lib/api-client', () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
}));

vi.mock('@/lib/admin-merchant-health', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/admin-merchant-health')
  >('@/lib/admin-merchant-health');

  return {
    ...actual,
    getAdminMerchantHealthPage: (...args: unknown[]) =>
      mockGetAdminMerchantHealthPage(...args),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { MerchantsClient } from './merchants-client';
import MerchantsPage from './page';

const merchantsResponse = {
  data: [
    {
      active_days: 2,
      business_name: 'Baci Store',
      email: 'owner@example.com',
      health_status: 'healthy' as const,
      joined_at: '2026-03-20T10:00:00.000Z',
      last_order_date: '2026-03-19',
      merchant_id: 'merchant-1',
      total_gmv: 400,
      total_orders: 2,
      excluded_non_ngn_or_unknown_paid_orders: 0,
    },
    {
      active_days: 0,
      business_name: 'Quiet Store',
      email: 'quiet@example.com',
      health_status: 'at_risk' as const,
      joined_at: '2026-03-21T10:00:00.000Z',
      last_order_date: null,
      merchant_id: 'merchant-2',
      total_gmv: 0,
      total_orders: 0,
      excluded_non_ngn_or_unknown_paid_orders: 0,
    },
  ],
  generatedAt: '2026-03-20T10:00:00.000Z',
  pagination: { limit: 50, offset: 0, total: 2 },
};

describe('Admin merchants page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue(merchantsResponse);
    mockCreateClient.mockResolvedValue({ rpc: vi.fn() });
    mockGetAdminMerchantHealthPage.mockResolvedValue({
      data: merchantsResponse.data,
      error: null,
      total: 2,
    });
  });

  it('loads merchant rows through the server-provided initial data', () => {
    render(
      <MerchantsClient
        initialHealthFilter="all"
        initialMerchants={merchantsResponse.data}
      />
    );

    expect(mockApiGet).not.toHaveBeenCalled();

    expect(screen.getByText('Baci Store')).toBeInTheDocument();
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
  });

  it('links each merchant row to the merchant user directory', () => {
    render(
      <MerchantsClient
        initialHealthFilter="all"
        initialMerchants={merchantsResponse.data}
      />
    );

    const merchantLink = screen.getByRole('link', {
      name: /baci store/i,
    });

    expect(merchantLink).toHaveAttribute('href', '/admin/merchants/merchant-1');
  });

  it('re-fetches the admin merchant list when the refresh button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MerchantsClient
        initialHealthFilter="all"
        initialMerchants={merchantsResponse.data}
      />
    );

    expect(screen.getByText('Baci Store')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledTimes(1);
    });
  });

  it('parses the initial health filter on the server page wrapper', async () => {
    render(
      await MerchantsPage({
        searchParams: Promise.resolve({ health: 'healthy' }),
      })
    );

    expect(await screen.findByText('Baci Store')).toBeInTheDocument();
    expect(screen.getByText('Quiet Store')).toBeInTheDocument();
  });

  it('falls back to all merchants for invalid or missing health filters', async () => {
    render(
      await MerchantsPage({
        searchParams: Promise.resolve({ health: 'inactive' }),
      })
    );

    expect(await screen.findByText('Baci Store')).toBeInTheDocument();
    expect(screen.getByText('Quiet Store')).toBeInTheDocument();
  });

  it('uses the first health search param when arrays are provided', async () => {
    render(
      await MerchantsPage({
        searchParams: Promise.resolve({ health: ['at_risk', 'healthy'] }),
      })
    );

    expect(await screen.findByText('Quiet Store')).toBeInTheDocument();
    expect(screen.getByText('Baci Store')).toBeInTheDocument();
  });

  it('renders an empty client state when the server merchant load fails', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockGetAdminMerchantHealthPage.mockResolvedValue({
      data: null,
      error: { message: 'database unavailable' },
      total: 0,
    });

    render(
      await MerchantsPage({
        searchParams: Promise.resolve({}),
      })
    );

    expect(errorSpy).toHaveBeenCalledWith(
      'Admin merchants initial load error:',
      {
        message: 'database unavailable',
      }
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Merchant data could not load.'
    );
    expect(screen.getByText('No merchants found')).toBeInTheDocument();

    errorSpy.mockRestore();
  });
});
