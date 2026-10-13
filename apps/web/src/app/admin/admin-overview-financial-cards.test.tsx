import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlatformAnalytics } from '@/types/analytics';
import { AdminOverviewFinancialCards } from './admin-overview-financial-cards';

const analytics = {
  summary: {
    recordedMerchantNet: 750,
    recordedPlatformFees: 1250,
    recordedProcessorFees: null,
  },
} as PlatformAnalytics;

describe('AdminOverviewFinancialCards', () => {
  it('renders recorded monetary values and makes missing currency data explicit', () => {
    render(
      <AdminOverviewFinancialCards analytics={analytics} loading={false} />
    );

    expect(screen.getByText('Recorded Platform Fees')).toBeInTheDocument();
    expect(screen.getByText('₦1.3K')).toBeInTheDocument();
    expect(screen.getByText('Recorded Processor Fees')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText(/₦750\.00/)).toBeInTheDocument();
  });

  it('does not present financial figures before data is available', () => {
    const { container } = render(
      <AdminOverviewFinancialCards analytics={null} loading />
    );

    expect(
      screen.queryByText('Recorded Platform Fees')
    ).not.toBeInTheDocument();
    expect(
      container.querySelectorAll('.motion-safe\\:animate-pulse')
    ).toHaveLength(9);
  });
});
