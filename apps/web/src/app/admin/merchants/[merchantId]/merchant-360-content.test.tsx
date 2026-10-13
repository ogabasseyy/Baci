import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminMerchant360Response } from '@/types/admin-merchant-360';
import { Merchant360Content } from './merchant-360-content';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const data: AdminMerchant360Response = {
  domain: {
    hasPrimary: true,
    primaryDomain: 'store.example.com',
    sslStatus: 'active',
    status: 'active',
    verifiedAt: '2026-08-05T10:00:00.000Z',
  },
  generatedAt: '2026-08-05T10:00:00.000Z',
  incidents: {
    domainEventFailures30d: 1,
    eventDeliveryDeadLetters30d: 2,
    shipmentFailures30d: 3,
  },
  merchant: {
    businessName: 'Merchant 360',
    createdAt: '2026-08-05T10:00:00.000Z',
    id: '11111111-1111-4111-8111-111111111111',
    isPublished: true,
    planTier: 'growth',
    signupSource: 'web',
    slug: 'merchant-360',
    updatedAt: '2026-08-05T10:00:00.000Z',
  },
  moneyCurrency: 'NGN',
  payouts: {
    completedAmount: 0,
    completedCount: 0,
    failedAmount: 0,
    failedCount: 1,
    pendingAmount: 1250,
    pendingCount: 2,
  },
  readiness: {
    hasStorefrontSlug: true,
    isPublished: true,
    paymentConfigured: true,
    shippingConfigured: false,
    storefrontReady: true,
  },
  recentAuditEvents: [],
  sales: {
    displayCurrencyPaidOrders: 3,
    excludedNonDisplayCurrencyPaidOrders: 1,
    lastPaidAt: null,
    paidGmv: 10000,
    paidOrders: 4,
  },
  settlements: {
    currency: null,
    failedAmount: null,
    failedCount: 1,
    pendingAmount: null,
    pendingCount: 2,
    settledAmount: null,
    settledCount: 0,
  },
  staffAccess: [{ role: 'manager', status: 'active', users: 2 }],
  summary: {
    activeAdminAppInstallations: 3,
    activeStorefrontAppInstallations: 4,
    customerUsers: 101,
    staffUsers: 2,
    unmatchedAppUsers: 0,
    webUsers: 102,
  },
};

describe('Merchant360Content', () => {
  it('renders aggregate operational detail without a people-level directory', () => {
    render(<Merchant360Content data={data} />);

    expect(screen.getByRole('heading', { name: 'Merchant 360' })).toBeVisible();
    expect(screen.getByText('Recent incidents (30d)')).toBeVisible();
    expect(screen.getByText('Paid GMV (NGN only)')).toBeVisible();
    expect(screen.getByText(/Paid GMV uses NGN only/i)).toBeVisible();
    expect(
      screen.getByText(/Amounts unavailable: the settlement ledger/i)
    ).toBeVisible();
    expect(
      screen.getByText(/1 paid orders in other or unknown currencies/i)
    ).toBeVisible();
    expect(screen.getByText('6')).toBeVisible();
    expect(screen.getByText(/aggregate access counts only/i)).toBeVisible();
    expect(screen.getByText('Manager · Active')).toBeVisible();
    expect(screen.queryByText('customer@example.com')).not.toBeInTheDocument();
  });

  it('does not mark a non-primary verified domain as ready', () => {
    render(
      <Merchant360Content
        data={{
          ...data,
          domain: {
            ...data.domain,
            hasPrimary: false,
          },
        }}
      />
    );

    const primaryDomainRow = screen.getByText(
      'Primary domain verified'
    ).parentElement;
    expect(primaryDomainRow).not.toBeNull();
    expect(
      within(primaryDomainRow as HTMLElement).getByText('Needs attention')
    ).toBeVisible();
  });
});
