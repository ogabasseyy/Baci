import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockToast = vi.fn();
const mockFetchWithCsrf = vi.fn();
const mockReplace = vi.fn();
const toastApi = { toast: mockToast };

function MockChart({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}

function MockResponsiveContainer({
  minHeight,
  minWidth,
}: {
  minHeight?: number;
  minWidth?: number;
}) {
  return (
    <div
      data-min-height={minHeight}
      data-min-width={minWidth}
      data-testid="responsive-container"
    />
  );
}

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('recharts', () => ({
  Area: MockChart,
  AreaChart: MockChart,
  CartesianGrid: MockChart,
  Cell: MockChart,
  Legend: MockChart,
  Pie: MockChart,
  PieChart: MockChart,
  ResponsiveContainer: MockResponsiveContainer,
  Tooltip: MockChart,
  XAxis: MockChart,
  YAxis: MockChart,
}));

vi.mock('@/components/analytics/analytics-card', () => ({
  AnalyticsCard: ({
    changeLabel,
    description,
    title,
    value,
  }: {
    changeLabel?: string;
    description?: string;
    title: string;
    value?: number | string;
  }) => (
    <div>
      <span>{title}</span>
      <span>{description}</span>
      <span>{changeLabel}</span>
      <span>{value}</span>
    </div>
  ),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => toastApi),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

import AdminDashboardPage from '@/app/admin/page';

const analyticsResponse = {
  dailyGmv: [],
  businessTypes: [],
  generatedAt: '2026-03-20T10:00:00.000Z',
  growth: {
    gmvGrowthRate: 0,
    merchantGrowthRate: 0,
    newMerchantsThisMonth: 0,
  },
  merchantHealth: {
    atRisk: 0,
    churned: 0,
    healthy: 1,
    new: 2,
  },
  summary: {
    activeMerchantChange: 0,
    activeMerchants: 1,
    aovChange: 0,
    avgGmvPerMerchant: 100,
    avgOrderValue: 100,
    grossGmv: 100,
    grossOrders: 1,
    gmvChange: 0,
    excludedNonNgnOrUnknownGrossOrders: 0,
    excludedNonNgnOrUnknownPaidOrders: 0,
    recordedMerchantNet: null,
    orderChange: 0,
    recordedPlatformFees: null,
    recordedProcessorFees: null,
    reportingCurrency: 'NGN',
    sellingMerchants: 1,
    totalGmv: 100,
    totalMerchants: 3,
    totalOrders: 1,
  },
  merchantActivation: [],
  paymentMethods: [],
  paymentStatuses: [],
  salesByChannel: [],
  shippingStatuses: [],
  signupSources: [
    { source: 'web', merchants: 2, shareOfMerchants: 66.7 },
    { source: 'ios', merchants: 1, shareOfMerchants: 33.3 },
    { source: 'android', merchants: 0, shareOfMerchants: 0 },
  ],
  topMerchants: [],
};

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => analyticsResponse,
        ok: true,
      }) as unknown as typeof fetch
    );
    mockFetchWithCsrf.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses CSRF-aware refresh requests for the admin analytics refresh action', async () => {
    const user = userEvent.setup();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/analytics?period=all'
      );
    });

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalledWith('/api/admin/analytics', {
        method: 'POST',
      });
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        '/api/admin/analytics?period=all'
      );
    });
  });

  it('sets explicit minimum dimensions on responsive charts', async () => {
    render(<AdminDashboardPage />);

    const containers = await screen.findAllByTestId('responsive-container');

    expect(containers.length).toBeGreaterThan(0);
    for (const container of containers) {
      expect(container).toHaveAttribute('data-min-width', '0');
      expect(container).toHaveAttribute('data-min-height', '0');
    }
  });

  it('labels estimates and paid-sales activity without claiming churn', async () => {
    const user = userEvent.setup();
    render(<AdminDashboardPage />);

    expect(
      await screen.findByText('Recorded Platform Fees')
    ).toBeInTheDocument();
    expect(screen.getByText('Recorded Processor Fees')).toBeInTheDocument();
    expect(screen.getByText('Merchant Sales Activity')).toBeInTheDocument();
    expect(
      screen.getByText('Sales Dormant (Over 90 Days)')
    ).toBeInTheDocument();
    expect(screen.queryByText('Churned')).not.toBeInTheDocument();
    expect(screen.getAllByText('N/A')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '30 Days' }));
    expect(
      await screen.findByText(
        'Across all recorded currencies; of 1 created in the last 30 days'
      )
    ).toBeInTheDocument();
  });

  it('shows a persistent retry state instead of empty dashboard figures after a load failure', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
        .mockResolvedValueOnce({
          json: async () => analyticsResponse,
          ok: true,
        } as Response)
    );

    render(<AdminDashboardPage />);

    expect(
      await screen.findByText('Platform analytics unavailable')
    ).toBeInTheDocument();
    expect(screen.queryByText('Paid GMV')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Paid GMV')).toBeInTheDocument();
    expect(
      screen.getByText('Merchants with Session Activity')
    ).toBeInTheDocument();
  });

  it('redirects away from the analytics-backed overview when analytics access is forbidden', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ status: 403 } as Response);

    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/admin/blog');
    });
    expect(
      screen.queryByText('Platform analytics unavailable')
    ).not.toBeInTheDocument();
  });
});
