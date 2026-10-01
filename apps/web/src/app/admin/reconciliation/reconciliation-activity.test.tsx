import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReconciliationActivity } from './reconciliation-activity';

describe('ReconciliationActivity', () => {
  it('renders a redacted activity row and pagination action', () => {
    const onLoadMore = vi.fn();
    render(
      <ReconciliationActivity
        data={{
          currency: 'USD',
          generatedAt: '2026-08-05T10:00:00.000Z',
          items: [
            {
              amount: 100,
              currency: 'USD',
              id: '00000000-0000-4000-8000-000000000001',
              issueType: null,
              lane: 'payout_request',
              merchantId: '00000000-0000-4000-8000-000000000002',
              merchantName: 'Baci merchant',
              occurredAt: '2026-08-05T09:00:00.000Z',
              provider: 'merchant_wallet',
              status: 'pending',
            },
            {
              amount: 9125,
              currency: 'UNK',
              id: '00000000-0000-4000-8000-000000000003',
              issueType: null,
              lane: 'platform_settlement',
              merchantId: '00000000-0000-4000-8000-000000000002',
              merchantName: 'Hostile settlement',
              occurredAt: '2026-08-05T08:00:00.000Z',
              provider: 'gateway',
              status: 'settled',
            },
          ],
          metrics: {
            capturedPayments: 0,
            directSettlements: { amount: null, count: 0 },
            openReviews: 0,
            paidOrderGmv: 0,
            platformSettlements: {
              failedAmount: null,
              failedCount: 0,
              pendingAmount: null,
              pendingCount: 0,
              settledAmount: null,
              settledCount: 0,
            },
            payoutRequests: {
              completedAmount: 0,
              completedCount: 0,
              failedAmount: 0,
              failedCount: 0,
              pendingAmount: 0,
              pendingCount: 0,
            },
            refunds: {
              pendingAmount: 0,
              pendingCount: 0,
              refundedAmount: 0,
              refundedCount: 0,
            },
            wallet: { availableAmount: 0, pendingAmount: 0, upcomingAmount: 0 },
          },
          nextCursor: {
            createdAt: '2026-08-05T09:00:00.000Z',
            id: '00000000-0000-4000-8000-000000000001',
          },
          periodStart: '2026-07-06T10:00:00.000Z',
          reviewScope: 'all_unresolved',
          supportedCurrencies: ['USD'],
        }}
        loadingMore={false}
        onLoadMore={onLoadMore}
      />
    );

    expect(screen.getByText('Baci merchant')).toBeInTheDocument();
    expect(screen.getByText('merchant wallet')).toBeInTheDocument();
    expect(screen.getByText('Hostile settlement')).toBeInTheDocument();
    expect(screen.queryByText('UNK')).not.toBeInTheDocument();
    expect(screen.queryByText(/9,125/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Load more' })
    ).toBeInTheDocument();
  });

  it('renders an explicit empty state', () => {
    render(
      <ReconciliationActivity
        data={{
          currency: 'NGN',
          generatedAt: '2026-08-05T10:00:00.000Z',
          items: [],
          metrics: {
            capturedPayments: 0,
            directSettlements: { amount: null, count: 0 },
            openReviews: 0,
            paidOrderGmv: 0,
            platformSettlements: {
              failedAmount: null,
              failedCount: 0,
              pendingAmount: null,
              pendingCount: 0,
              settledAmount: null,
              settledCount: 0,
            },
            payoutRequests: {
              completedAmount: 0,
              completedCount: 0,
              failedAmount: 0,
              failedCount: 0,
              pendingAmount: 0,
              pendingCount: 0,
            },
            refunds: {
              pendingAmount: 0,
              pendingCount: 0,
              refundedAmount: 0,
              refundedCount: 0,
            },
            wallet: { availableAmount: 0, pendingAmount: 0, upcomingAmount: 0 },
          },
          nextCursor: null,
          periodStart: '2026-07-06T10:00:00.000Z',
          reviewScope: 'all_unresolved',
          supportedCurrencies: ['NGN'],
        }}
        loadingMore={false}
        onLoadMore={vi.fn()}
      />
    );

    expect(
      screen.getByText(/No safe reconciliation records/i)
    ).toBeInTheDocument();
  });
});
