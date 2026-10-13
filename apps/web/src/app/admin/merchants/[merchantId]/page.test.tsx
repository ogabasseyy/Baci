import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateClient = vi.fn();
const mockGetAdminMerchant360 = vi.fn();
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

vi.mock('next/navigation', () => ({ notFound: () => mockNotFound() }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/admin-merchant-360', () => ({
  getAdminMerchant360: (...args: unknown[]) => mockGetAdminMerchant360(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const response = {
  domain: {
    hasPrimary: false,
    primaryDomain: null,
    sslStatus: null,
    status: null,
    verifiedAt: null,
  },
  generatedAt: '2026-03-20T10:00:00.000Z',
  moneyCurrency: 'NGN',
  incidents: {
    domainEventFailures30d: 0,
    eventDeliveryDeadLetters30d: 0,
    shipmentFailures30d: 0,
  },
  merchant: {
    businessName: 'Unpublished Store',
    createdAt: '2026-03-20T10:00:00.000Z',
    id: MERCHANT_ID,
    isPublished: false,
    planTier: 'free',
    signupSource: 'web',
    slug: 'unpublished-store',
    updatedAt: '2026-03-20T10:00:00.000Z',
  },
  payouts: {
    completedAmount: 0,
    completedCount: 0,
    failedAmount: 0,
    failedCount: 0,
    pendingAmount: 0,
    pendingCount: 0,
  },
  readiness: {
    hasStorefrontSlug: true,
    isPublished: false,
    paymentConfigured: true,
    shippingConfigured: true,
    storefrontReady: false,
  },
  recentAuditEvents: [],
  sales: { lastPaidAt: null, paidGmv: 0, paidOrders: 0 },
  staffAccess: [{ role: 'manager', status: 'active', users: 2 }],
  settlements: {
    failedAmount: 0,
    failedCount: 0,
    pendingAmount: 0,
    pendingCount: 0,
    settledAmount: 0,
    settledCount: 0,
  },
  summary: {
    activeAdminAppInstallations: 0,
    activeStorefrontAppInstallations: 0,
    customerUsers: 101,
    staffUsers: 0,
    unmatchedAppUsers: 0,
    webUsers: 102,
  },
};

import Merchant360Page from '@/app/admin/merchants/[merchantId]/page';

describe('Merchant360Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({ rpc: vi.fn() });
    mockGetAdminMerchant360.mockResolvedValue({ data: response, error: null });
  });

  it('renders an unpublished merchant with exact counts but no people-level directory', async () => {
    render(
      await Merchant360Page({
        params: Promise.resolve({ merchantId: MERCHANT_ID }),
      })
    );

    expect(
      screen.getByRole('heading', { name: /unpublished store/i })
    ).toBeVisible();
    expect(
      screen.getByRole('group', { name: 'Customers summary' })
    ).toHaveTextContent('101');
    expect(screen.getByText(/aggregate access counts only/i)).toBeVisible();
    expect(screen.queryByText('customer@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('owner@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('Manager · Active')).toBeVisible();
    expect(screen.getAllByText('Needs attention')).not.toHaveLength(0);
  });

  it('renders a forbidden state when the RPC rejects a non-admin', async () => {
    mockGetAdminMerchant360.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'platform_admin_required' },
    });

    render(
      await Merchant360Page({
        params: Promise.resolve({ merchantId: MERCHANT_ID }),
      })
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  });

  it('uses notFound when the platform-admin RPC cannot find the merchant', async () => {
    mockGetAdminMerchant360.mockResolvedValue({ data: null, error: null });

    await expect(
      Merchant360Page({ params: Promise.resolve({ merchantId: MERCHANT_ID }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
