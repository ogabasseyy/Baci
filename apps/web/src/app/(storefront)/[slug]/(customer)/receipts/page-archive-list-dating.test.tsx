import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceiptsPage from '@/app/(storefront)/[slug]/(customer)/receipts/page';
import { useMerchant } from '@/hooks/use-merchant-client';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('next/link', () => ({
  default: vi.fn(
    ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  ),
}));

vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: vi.fn(() => ({
    customer: { id: 'customer-1' },
    isAuthenticated: true,
    isLoading: false,
  })),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: vi.fn(() => ({
    merchant: { slug: 'default', template_id: 'default' },
    loading: false,
    basePath: '/default',
  })),
}));

vi.mock('@/components/storefront/ogabassey/pages/receipts', () => ({
  OgabasseyV2Receipts: () => (
    <div data-testid="ogabassey-receipts-page">Ogabassey Receipts Page</div>
  ),
}));

import {
  createJsonResponse,
  createMerchantMock,
} from './page-archive-list.test-support';

describe('ReceiptsPage archive list dating', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(useMerchant).mockReturnValue(
      createMerchantMock({
        slug: 'default',
        templateId: 'default',
        basePath: '/default',
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('dates archive cards by the document date, not record creation', async () => {
    // A backdated invoice must show its issue date and a completed
    // receipt its completion-backed transaction date — the same
    // issue → transaction → creation fallback the API sorts by.
    const formatter = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const issueText = formatter.format(new Date('2026-03-15T12:00:00.000Z'));
    const completionText = formatter.format(
      new Date('2026-10-20T12:00:00.000Z')
    );
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        orders: [
          {
            id: 'manual-backdated',
            order_number: 'MANUAL-BACKDATED',
            created_at: '2026-09-30T09:00:00Z',
            invoice_issue_date: '2026-03-15T12:00:00.000Z',
            transaction_date: null,
            total: 100,
            shipping_status: 'pending',
            current_document_kind: 'invoice',
            is_manual_order: true,
            manual_document_available: true,
            receipt_eligible: false,
            items: [
              {
                id: 'manual-item',
                name: 'Manual Device',
                quantity: 1,
                price: 100,
              },
            ],
          },
          {
            id: 'manual-completed',
            order_number: 'MANUAL-COMPLETED',
            created_at: '2026-01-10T09:00:00Z',
            invoice_issue_date: null,
            transaction_date: '2026-10-20T12:00:00.000Z',
            total: 100,
            shipping_status: 'pending',
            current_document_kind: 'receipt',
            is_manual_order: true,
            manual_document_available: true,
            receipt_eligible: true,
            items: [
              {
                id: 'manual-item-2',
                name: 'Manual Device',
                quantity: 1,
                price: 100,
              },
            ],
          },
        ],
      })
    );

    render(<ReceiptsPage />);

    expect(await screen.findByText('#MANUAL-BACKDATED')).toBeInTheDocument();
    expect(screen.getByText('#MANUAL-COMPLETED')).toBeInTheDocument();
    const dateLine = (text: string) => (_: string, el: Element | null) =>
      el?.textContent?.startsWith(text) ?? false;
    expect(screen.getByText(dateLine(issueText))).toBeInTheDocument();
    expect(screen.getByText(dateLine(completionText))).toBeInTheDocument();
  });
  it('keeps date-only issue dates on their calendar day west of UTC', async () => {
    // A date-only issue date has no time component: midnight UTC plus a
    // local formatter shows the previous day west of UTC, so the card
    // formats date-only values in UTC. The page formatter captures the
    // timezone at import, so re-import the page under New York time.
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    vi.resetModules();
    try {
      const { default: FreshReceiptsPage } = await import(
        '@/app/(storefront)/[slug]/(customer)/receipts/page'
      );
      vi.mocked(fetch).mockResolvedValue(
        createJsonResponse({
          orders: [
            {
              id: 'manual-date-only',
              order_number: 'MANUAL-DATE-ONLY',
              created_at: '2026-09-30T09:00:00Z',
              invoice_issue_date: '2026-03-15',
              transaction_date: null,
              total: 100,
              shipping_status: 'pending',
              current_document_kind: 'invoice',
              is_manual_order: true,
              manual_document_available: true,
              receipt_eligible: false,
              items: [
                {
                  id: 'manual-item-3',
                  name: 'Manual Device',
                  quantity: 1,
                  price: 100,
                },
              ],
            },
          ],
        })
      );

      render(<FreshReceiptsPage />);

      expect(await screen.findByText('#MANUAL-DATE-ONLY')).toBeInTheDocument();
      const dateLine = (_: string, el: Element | null) =>
        el?.textContent?.startsWith('Mar 15, 2026') ?? false;
      expect(screen.getByText(dateLine)).toBeInTheDocument();
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
      vi.resetModules();
    }
  });
});
