import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformAnalytics } from '@/types/analytics';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { AdminOverviewTopMerchants } from './admin-overview-top-merchants';

const analytics = {
  topMerchants: [
    { gmv: 1200, id: '1', name: 'First Store', orders: 8 },
    { gmv: 450, id: '2', name: 'Second Store', orders: 2 },
  ],
} as PlatformAnalytics;

describe('AdminOverviewTopMerchants', () => {
  it('lists ranked merchants and retains the period-specific paid-GMV scope', () => {
    render(
      <AdminOverviewTopMerchants
        analytics={analytics}
        loading={false}
        period="7d"
      />
    );

    expect(screen.getByText('First Store')).toBeInTheDocument();
    expect(screen.getByText('8 orders')).toBeInTheDocument();
    expect(
      screen.getByText(/by NGN paid GMV in the last 7 days/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute(
      'href',
      '/admin/merchants'
    );
  });

  it('uses an explicit empty state when merchants are absent', () => {
    render(
      <AdminOverviewTopMerchants
        analytics={null}
        loading={false}
        period="all"
      />
    );

    expect(
      screen.getByText('No merchant data available yet')
    ).toBeInTheDocument();
  });
});
