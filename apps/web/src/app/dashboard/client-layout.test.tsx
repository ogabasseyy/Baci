import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantContextType, MerchantData } from '@/hooks/merchant/types';

const { mockOpenUpgradeModal, mockOrdersCount } = vi.hoisted(() => ({
  mockOpenUpgradeModal: vi.fn(),
  mockOrdersCount: { value: 0 },
}));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn().mockReturnValue('/dashboard'),
  useRouter: vi.fn().mockReturnValue({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: vi.fn().mockReturnValue({
    user: { id: 'user-1', email: 'test@example.com' },
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: vi.fn().mockReturnValue({
    merchant: {
      id: 'merchant-1',
      slug: 'test-store',
      country: 'NG',
      custom_domain: null,
    },
    loading: false,
    updateMerchant: vi.fn(),
    hasPermission: vi.fn().mockReturnValue(true),
    staffAccess: { isOwner: true },
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(),
}));

vi.mock('@/components/dashboard/upgrade-modal', () => ({
  useUpgradeModal: () => ({
    close: vi.fn(),
    feature: null,
    isOpen: false,
    open: mockOpenUpgradeModal,
    targetPlan: 'pro',
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve({ count: mockOrdersCount.value })
          ),
      }),
    }),
  }),
}));

vi.mock('@/components/notifications/notification-banner', () => ({
  NotificationBanner: () => null,
}));

vi.mock('@/components/notifications/notification-center', () => ({
  NotificationCenter: () => null,
}));

import { useMerchant } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import DashboardClientLayout from './client-layout';

const defaultMerchant: MerchantData = {
  business_name: 'Test Store',
  business_type: 'retail',
  country: 'NG',
  id: 'merchant-1',
  slug: 'test-store',
  user_id: 'user-1',
};

const defaultStaffAccess: MerchantContextType['staffAccess'] = {
  isOwner: true,
  isStaff: false,
  permissions: {},
  role: null,
};
const smartNavStorageKey = 'baci.dashboard.smartNav.merchant-1';
function createMerchantHookValue(
  overrides: Partial<MerchantContextType> = {}
): MerchantContextType {
  return {
    basePath: '/test-store',
    hasPermission: vi.fn<MerchantContextType['hasPermission']>(() => true),
    loading: false,
    merchant: defaultMerchant,
    navigationCategories: [],
    reloadMerchant: vi.fn<MerchantContextType['reloadMerchant']>(),
    routingMode: 'path',
    staffAccess: defaultStaffAccess,
    updateMerchant: vi.fn<MerchantContextType['updateMerchant']>(
      async () => undefined
    ),
    ...overrides,
  };
}

function mockUseMerchantForLayout(value: ReturnType<typeof useMerchant>) {
  vi.mocked(useMerchant).mockReturnValue(value);
}

function renderLayout(content = 'Test Content') {
  return render(
    <DashboardClientLayout>
      <div>{content}</div>
    </DashboardClientLayout>
  );
}

function setSmartNavUsage(usage: unknown) {
  localStorage.setItem(smartNavStorageKey, JSON.stringify(usage));
}

describe('DashboardClientLayout', () => {
  it('does not subscribe to toast state', () => {
    renderLayout();

    // The layout never renders toasts; subscribing would re-render the
    // whole shell on every toast fired anywhere in the dashboard.
    expect(vi.mocked(useToast)).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    localStorage.clear();
    mockOpenUpgradeModal.mockClear();
    mockOrdersCount.value = 0;
    mockUseMerchantForLayout(createMerchantHookValue());
  });

  it('renders core navigation links after expanding the capsule', async () => {
    renderLayout();

    await userEvent.click(
      screen.getByRole('button', { name: 'Show all navigation' })
    );

    for (const [name, href] of [
      ['Orders', '/dashboard/orders'],
      ['Products', '/dashboard/products'],
      ['Migrations', '/dashboard/migrations'],
      ['Quiz', '/dashboard/quiz'],
      ['Agentic', '/dashboard/agentic'],
    ] as const) {
      expect(screen.getAllByRole('link', { name })[0]).toHaveAttribute(
        'href',
        href
      );
    }
  });

  it('expands the navigation capsule vertically in place', async () => {
    renderLayout();

    const capsule = screen.getByRole('complementary', {
      name: 'Quick navigation',
    });

    expect(
      within(capsule).getByRole('navigation', {
        name: 'Navigation shortcuts',
      })
    ).toBeInTheDocument();
    expect(
      within(capsule).getByRole('link', { name: 'Dashboard' })
    ).toHaveAttribute('href', '/dashboard');
    expect(
      within(capsule).getByRole('link', { name: 'Products' })
    ).toHaveAttribute('href', '/dashboard/products');

    await userEvent.click(
      within(capsule).getByRole('button', { name: 'Show all navigation' })
    );

    expect(
      within(capsule).getByRole('navigation', { name: 'All navigation' })
    ).toBeInTheDocument();
    expect(
      within(capsule).getByRole('link', { name: 'Migrations' })
    ).toHaveAttribute('href', '/dashboard/migrations');
  });

  it('places Marketing after Products in the expanded capsule', async () => {
    renderLayout();

    await userEvent.click(
      screen.getByRole('button', { name: 'Show all navigation' })
    );

    const mainNav = screen.getByRole('navigation', { name: 'All navigation' });
    const navLabels = within(mainNav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label'));

    expect(navLabels.slice(0, 9)).toEqual([
      'Dashboard',
      'Analytics',
      'Orders',
      'Products',
      'Marketing',
      'Discount Codes',
      'Blog',
      'Marketplaces',
      'Domains',
    ]);
    expect(
      within(mainNav).getByRole('link', { name: 'Marketing' })
    ).toHaveAttribute('href', '/dashboard/marketing');
    expect(
      within(mainNav).getByRole('link', { name: 'Discount Codes' })
    ).toHaveAttribute('href', '/dashboard/marketing/discount-codes');
    expect(
      within(mainNav).queryByRole('link', { name: 'Integrations' })
    ).not.toBeInTheDocument();
  });

  it('keeps the complete navigation order independent from usage history', async () => {
    setSmartNavUsage({
      'discount-codes': {
        clickCount: 6,
        lastClickedAt: '2026-05-28T21:00:00.000Z',
      },
      products: {
        clickCount: 4,
        lastClickedAt: '2026-05-28T20:00:00.000Z',
      },
      seo: {
        clickCount: 2,
        lastClickedAt: '2026-05-28T19:00:00.000Z',
      },
    });

    renderLayout();

    await userEvent.click(
      screen.getByRole('button', { name: 'Show all navigation' })
    );
    expect(screen.getByRole('link', { name: 'Migrations' })).toHaveAttribute(
      'href',
      '/dashboard/migrations'
    );
  });

  it('records dashboard navigation clicks in merchant scoped storage', async () => {
    renderLayout();

    await userEvent.click(screen.getAllByRole('link', { name: 'Products' })[0]);

    const rawUsage = localStorage.getItem(smartNavStorageKey);

    expect(rawUsage).not.toBeNull();
    expect(JSON.parse(rawUsage ?? '{}')).toMatchObject({
      products: {
        clickCount: 1,
      },
    });
  });

  it('hides the Migrations nav item when the merchant lacks permission', () => {
    mockUseMerchantForLayout(
      createMerchantHookValue({
        hasPermission: vi.fn(() => false),
        staffAccess: { ...defaultStaffAccess, isOwner: false },
      })
    );

    renderLayout();

    expect(
      screen.queryByRole('link', { name: 'Migrations' })
    ).not.toBeInTheDocument();
  });

  it('hides Agentic when integrations view permission is false', () => {
    mockUseMerchantForLayout(
      createMerchantHookValue({
        hasPermission: vi.fn((resource: string, action: string) => {
          if (resource === 'integrations' && action === 'view') {
            return false;
          }
          return true;
        }),
        staffAccess: { ...defaultStaffAccess, isOwner: false },
      })
    );

    renderLayout();

    expect(
      screen.queryByRole('link', { name: 'Agentic' })
    ).not.toBeInTheDocument();
  });
});
