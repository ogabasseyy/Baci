import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlatformAnalytics } from '@/types/analytics';
import { AnalyticsSummaryCards } from './analytics-summary-cards';

const analytics = {
  summary: {
    activeMerchants: 12,
    aovChange: -4.5,
    avgOrderValue: 500,
    excludedNonNgnOrUnknownPaidOrders: 2,
    gmvChange: 12.5,
    orderChange: -3,
    sellingMerchants: 4,
    totalGmv: 1200,
    totalOrders: 9,
  },
} as PlatformAnalytics;

describe('AnalyticsSummaryCards', () => {
  it('renders supplied metrics, signed trend direction, and the money scope warning', () => {
    render(<AnalyticsSummaryCards analytics={analytics} loading={false} />);

    expect(screen.getByText('Paid GMV')).toBeInTheDocument();
    expect(screen.getByText('12.5%')).toBeInTheDocument();
    expect(screen.getByText('3.0%')).toBeInTheDocument();
    expect(
      screen.getByText(/2 paid order\(s\) outside that money total/)
    ).toBeInTheDocument();
    expect(screen.getByText(/4 made NGN paid sales/)).toBeInTheDocument();
  });

  it('defaults absent analytics to clear zero values rather than throwing', () => {
    render(<AnalyticsSummaryCards analytics={null} loading={false} />);

    expect(screen.getAllByText('₦0.00')).toHaveLength(2);
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(
      screen.getByText(
        'NGN-only reporting; orders created in the selected window'
      )
    ).toBeInTheDocument();
  });
});
