// Shared mocks and render helpers for the DashboardClientLayout suites.
import { render } from '@testing-library/react';
import type React from 'react';
import { vi } from 'vitest';
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

vi.mock('@/components/notifications/onboarding-reminder', () => ({
  OnboardingReminderBanner: () => <div data-testid="onboarding-reminder" />,
}));

vi.mock('@/components/notifications/notification-center', () => ({
  NotificationCenter: () => null,
}));

import { useMerchant } from '@/hooks/use-merchant-client';
import DashboardClientLayout from './client-layout';

export const defaultMerchant: MerchantData = {
  business_name: 'Test Store',
  business_type: 'retail',
  country: 'NG',
  id: 'merchant-1',
  slug: 'test-store',
  user_id: 'user-1',
};

export const defaultStaffAccess: MerchantContextType['staffAccess'] = {
  isOwner: true,
  isStaff: false,
  permissions: {},
  role: null,
};
export const smartNavStorageKey = 'baci.dashboard.smartNav.merchant-1';
export function createMerchantHookValue(
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

export function mockUseMerchantForLayout(
  value: ReturnType<typeof useMerchant>
) {
  vi.mocked(useMerchant).mockReturnValue(value);
}

export function renderLayout(content = 'Test Content') {
  return render(
    <DashboardClientLayout>
      <div>{content}</div>
    </DashboardClientLayout>
  );
}

export function setSmartNavUsage(usage: unknown) {
  localStorage.setItem(smartNavStorageKey, JSON.stringify(usage));
}

export { mockOpenUpgradeModal, mockOrdersCount };
