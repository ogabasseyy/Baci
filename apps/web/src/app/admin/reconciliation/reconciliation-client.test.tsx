import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminReconciliationData } from '@/schemas/admin-reconciliation-rpc';
import { ReconciliationClient } from './reconciliation-client';

Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
  configurable: true,
  value: () => false,
});
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: () => undefined,
});

const responseData = {
  currency: 'NGN',
  generatedAt: '2026-08-05T10:00:00.000Z',
  items: [],
  metrics: {
    capturedPayments: 2500,
    directSettlements: { amount: null, count: 0 },
    openReviews: 0,
    paidOrderGmv: 2500,
    platformSettlements: {
      failedAmount: null,
      failedCount: 0,
      pendingAmount: null,
      pendingCount: 0,
      settledAmount: null,
      settledCount: 1,
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
  supportedCurrencies: ['NGN', 'USD'],
} satisfies AdminReconciliationData;

const pagedResponseData = {
  ...responseData,
  items: [
    {
      amount: 2500,
      currency: 'NGN',
      id: 'current-row',
      issueType: null,
      lane: 'payout_request',
      merchantId: null,
      merchantName: 'Current merchant',
      occurredAt: '2026-08-05T10:00:00.000Z',
      provider: 'paystack',
      status: 'pending',
    },
  ],
  nextCursor: {
    createdAt: '2026-08-04T10:00:00.000Z',
    id: 'current-cursor',
  },
} satisfies AdminReconciliationData;

type ReconciliationFetchResponse = {
  json: () => Promise<AdminReconciliationData>;
  ok: boolean;
};

describe('ReconciliationClient', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => responseData,
        ok: true,
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders separated money lanes and an explicit empty state', async () => {
    render(<ReconciliationClient />);

    expect(screen.getByText('Reconciliation')).toBeInTheDocument();
    expect(
      screen.getByText(/matching recorded commerce activity/i)
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/reconciliation?currency=NGN&lane=all&limit=50&period=30d&status=all',
        expect.objectContaining({ method: 'GET' })
      );
    });

    expect(await screen.findByText('Paid order GMV')).toBeInTheDocument();
    expect(await screen.findByText('Captured payments')).toBeInTheDocument();
    expect(
      await screen.findByText(/No safe reconciliation records/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/wallet balances are current/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/open reviews include every unresolved review/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Export first 100 matching rows' })
    ).toBeInTheDocument();
  });

  it('clears prior financial results when a newly selected currency cannot load', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          json: async () => responseData,
          ok: true,
        })
        .mockRejectedValueOnce(new Error('network unavailable'))
    );
    render(<ReconciliationClient />);

    await screen.findByText('Paid order GMV');
    await user.click(screen.getByRole('combobox', { name: 'Currency' }));
    await user.click(screen.getByRole('option', { name: 'USD' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Reconciliation data could not load.'
      );
    });
    expect(screen.queryByText('Paid order GMV')).not.toBeInTheDocument();
  });

  it('does not append a stale page after the filters change', async () => {
    const user = userEvent.setup();
    let resolveStalePage: (response: ReconciliationFetchResponse) => void;
    const stalePage = new Promise<ReconciliationFetchResponse>((resolve) => {
      resolveStalePage = resolve;
    });
    const filteredResponse = {
      ...responseData,
      currency: 'USD',
      items: [
        {
          ...pagedResponseData.items[0],
          currency: 'USD',
          id: 'filtered-row',
          merchantName: 'Filtered merchant',
        },
      ],
      nextCursor: {
        createdAt: '2026-08-03T10:00:00.000Z',
        id: 'filtered-cursor',
      },
    } satisfies AdminReconciliationData;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          json: async () => pagedResponseData,
          ok: true,
        })
        .mockReturnValueOnce(stalePage)
        .mockResolvedValueOnce({
          json: async () => filteredResponse,
          ok: true,
        })
    );
    render(<ReconciliationClient />);

    expect(await screen.findByText('Current merchant')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('combobox', { name: 'Currency' }));
    await user.click(screen.getByRole('option', { name: 'USD' }));
    expect(await screen.findByText('Filtered merchant')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();

    await act(async () => {
      resolveStalePage({
        json: async () =>
          ({
            ...pagedResponseData,
            items: [
              {
                ...pagedResponseData.items[0],
                id: 'stale-row',
                merchantName: 'Stale merchant',
              },
            ],
            nextCursor: null,
          }) satisfies AdminReconciliationData,
        ok: true,
      });
    });

    expect(screen.queryByText('Stale merchant')).not.toBeInTheDocument();
  });
});
