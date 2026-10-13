import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ReconciliationMetricSkeletons,
  ReconciliationMetrics,
} from './reconciliation-metrics';

const data = {
  currency: 'USD',
  generatedAt: '2026-08-05T10:00:00.000Z',
  items: [],
  metrics: {
    capturedPayments: 20,
    directSettlements: { amount: null, count: 1 },
    openReviews: 2,
    paidOrderGmv: 25,
    platformSettlements: {
      failedAmount: null,
      failedCount: 0,
      pendingAmount: null,
      pendingCount: 1,
      settledAmount: null,
      settledCount: 2,
    },
    payoutRequests: {
      completedAmount: 0,
      completedCount: 0,
      failedAmount: 0,
      failedCount: 0,
      pendingAmount: 1,
      pendingCount: 1,
    },
    refunds: {
      pendingAmount: 0,
      pendingCount: 0,
      refundedAmount: 1,
      refundedCount: 1,
    },
    wallet: { availableAmount: 3, pendingAmount: 0, upcomingAmount: 0 },
  },
  nextCursor: null,
  periodStart: '2026-07-06T10:00:00.000Z',
  reviewScope: 'all_unresolved' as const,
  supportedCurrencies: ['USD'],
};

describe('ReconciliationMetrics', () => {
  it('renders separate financial lane definitions', () => {
    render(<ReconciliationMetrics data={data} />);

    expect(screen.getByText('Paid order GMV')).toBeInTheDocument();
    expect(screen.getByText('Captured payments')).toBeInTheDocument();
    expect(screen.getByText(/not period totals/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Historical settlement currency is not recorded/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/all unresolved reviews/i)).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).toHaveLength(3);
    expect(
      screen.queryByText(/settlement.*follows the merchant payout currency/i)
    ).not.toBeInTheDocument();
  });

  it('exposes an accessible skeleton while records are loading', () => {
    render(<ReconciliationMetricSkeletons />);

    expect(screen.getByRole('generic', { busy: true })).toBeInTheDocument();
  });
});
