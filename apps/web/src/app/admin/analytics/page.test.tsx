import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastApi = { toast: vi.fn() };

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

vi.mock('recharts', () => ({
  Area: MockChart,
  AreaChart: MockChart,
  Bar: MockChart,
  BarChart: MockChart,
  CartesianGrid: MockChart,
  ResponsiveContainer: MockResponsiveContainer,
  Tooltip: MockChart,
  XAxis: MockChart,
  YAxis: MockChart,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => toastApi,
}));

import AnalyticsPage from '@/app/admin/analytics/page';

const analyticsResponse = {
  businessTypes: [],
  dailyGmv: [
    {
      date: '2026-03-20',
      gmv: 1200,
      merchants: 3,
      orders: 2,
    },
  ],
  generatedAt: '2026-03-20T10:00:00.000Z',
  growth: {
    gmvGrowthRate: 50,
    merchantGrowthRate: 25,
    newMerchantsThisMonth: 4,
  },
  merchantActivation: [],
  merchantHealth: {
    atRisk: 0,
    churned: 0,
    healthy: 2,
    new: 1,
  },
  paymentMethods: [
    {
      amount: 700,
      label: 'Card',
      method: 'card',
      orders: 1,
      shareOfPaidAmount: 100,
      shareOfPaidOrders: 100,
    },
  ],
  paymentStatuses: [
    {
      amount: 700,
      label: 'Paid',
      orders: 1,
      shareOfAmount: 70,
      shareOfOrders: 50,
      status: 'paid',
    },
    {
      amount: 300,
      label: 'Pending',
      orders: 1,
      shareOfAmount: 30,
      shareOfOrders: 50,
      status: 'pending',
    },
  ],
  salesByChannel: [],
  shippingStatuses: [
    {
      amount: 700,
      label: 'Processing',
      orders: 1,
      shareOfAmount: 70,
      shareOfOrders: 50,
      status: 'processing',
    },
  ],
  signupSources: [],
  summary: {
    activeMerchantChange: 20,
    activeMerchants: 12,
    aovChange: -10,
    avgGmvPerMerchant: 100,
    avgOrderValue: 700,
    grossGmv: 1000,
    grossOrders: 2,
    gmvChange: 50,
    excludedNonNgnOrUnknownGrossOrders: 0,
    excludedNonNgnOrUnknownPaidOrders: 0,
    recordedMerchantNet: null,
    orderChange: 25,
    recordedPlatformFees: null,
    recordedProcessorFees: null,
    reportingCurrency: 'NGN',
    sellingMerchants: 2,
    totalGmv: 700,
    totalMerchants: 20,
    totalOrders: 1,
  },
  topMerchants: [
    {
      gmv: 700,
      id: 'merchant-1',
      name: 'Baci Store',
      orders: 1,
    },
  ],
};

function createAnalyticsResponse(status = 200): Response {
  return new Response(JSON.stringify(analyticsResponse), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createAnalyticsResponse())
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders real analytics payload data and order pipeline breakdowns', async () => {
    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/analytics?period=30d'
      );
    });

    expect(
      await screen.findByText('Merchants with Session Activity')
    ).toBeInTheDocument();
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(
      await screen.findByText(
        /NGN-only reporting; orders created in the selected window/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/order metrics use the order-created date/i)
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/2 made ngn paid sales/i)
    ).toBeInTheDocument();
    expect(await screen.findByText('Payment Pipeline')).toBeInTheDocument();
    expect(await screen.findByText('Paid')).toBeInTheDocument();
    expect(await screen.findByText('Fulfillment Pipeline')).toBeInTheDocument();
    expect(await screen.findByText('Processing')).toBeInTheDocument();
    expect(await screen.findByText('Paid Order Methods')).toBeInTheDocument();
    expect(await screen.findByText('Card')).toBeInTheDocument();
  });

  it('sets explicit minimum dimensions on responsive charts', async () => {
    render(<AnalyticsPage />);

    const containers = await screen.findAllByTestId('responsive-container');

    expect(containers.length).toBeGreaterThan(0);
    for (const container of containers) {
      expect(container).toHaveAttribute('data-min-width', '0');
      expect(container).toHaveAttribute('data-min-height', '0');
    }
  });

  it('shows a persistent retry state instead of convincing zero metrics when loading fails', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(createAnalyticsResponse());

    render(<AnalyticsPage />);

    expect(
      await screen.findByText('Analytics unavailable')
    ).toBeInTheDocument();
    expect(screen.queryByText('₦0.00')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByText('Merchants with Session Activity')
    ).toBeInTheDocument();
    expect(await screen.findByText('12')).toBeInTheDocument();
  });

  it('keeps prior analytics figures and reports a non-blocking error when refresh fails', async () => {
    const user = userEvent.setup();
    let resolveRefresh: (response: Response) => void = () => undefined;
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(createAnalyticsResponse())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveRefresh = resolve;
          })
      );

    render(<AnalyticsPage />);

    expect(await screen.findByText('12')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Refreshing live analytics'
    );
    expect(screen.getByText('12')).toBeInTheDocument();

    resolveRefresh(new Response(null, { status: 500 }));

    expect(
      await screen.findByText('Analytics refresh failed')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Merchants with Session Activity')
    ).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});
