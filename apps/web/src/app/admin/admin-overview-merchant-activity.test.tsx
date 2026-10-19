import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformAnalytics } from '@/types/analytics';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('recharts', () => ({
  Cell: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Legend: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Pie: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PieChart: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

import { AdminOverviewMerchantActivity } from './admin-overview-merchant-activity';

const analytics = {
  merchantHealth: { atRisk: 2, churned: 1, healthy: 3, new: 4 },
} as PlatformAnalytics;

describe('AdminOverviewMerchantActivity', () => {
  it('shows activity counts with filters that match each activity category', () => {
    render(
      <AdminOverviewMerchantActivity analytics={analytics} loading={false} />
    );

    expect(screen.getByText('Selling (Last 30 Days)')).toBeInTheDocument();
    expect(
      screen.getByText('Sales Dormant (Over 90 Days)')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sales quiet/i })).toHaveAttribute(
      'href',
      '/admin/merchants?health=at_risk'
    );
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('keeps activity cards at zero and reports no chart data for an empty payload', () => {
    render(<AdminOverviewMerchantActivity analytics={null} loading={false} />);

    expect(screen.getByText('No merchant data available')).toBeInTheDocument();
    expect(screen.getAllByText('0')).toHaveLength(4);
  });
});
