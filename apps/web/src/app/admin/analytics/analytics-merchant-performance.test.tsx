import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlatformAnalytics } from '@/types/analytics';
import { AnalyticsMerchantPerformance } from './analytics-merchant-performance';

const analytics = {
  summary: { totalGmv: 1000 },
  topMerchants: [
    { gmv: 1250, id: 'first', name: 'Leading Store', orders: 8 },
    { gmv: 250, id: 'second', name: 'Growing Store', orders: 2 },
  ],
} as PlatformAnalytics;

describe('AnalyticsMerchantPerformance', () => {
  it('ranks merchants and caps a contribution bar at 100 percent', () => {
    const { container } = render(
      <AnalyticsMerchantPerformance analytics={analytics} loading={false} />
    );

    expect(screen.getByText('Leading Store')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText(/₦1\.3K/)).toBeInTheDocument();
    expect(
      container.querySelector('[style="width: 100%;"]')
    ).toBeInTheDocument();
  });

  it('uses the no-data state instead of a misleading empty ranking', () => {
    render(<AnalyticsMerchantPerformance analytics={null} loading={false} />);

    expect(screen.getByText('No merchant data available')).toBeInTheDocument();
  });
});
