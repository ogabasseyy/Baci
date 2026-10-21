import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantProvider } from './merchant/merchant-provider';
import type { MerchantData, StaffAccess } from './use-merchant';
import { useMerchant, useMerchantSafe } from './use-merchant-client';

// Mock Supabase client
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

// Mock auth context
const mockUser = { id: 'user-123', email: 'test@test.com' };
vi.mock('@/contexts/auth-context', () => ({
  useAuthSafe: () => ({ user: mockUser, loading: false, signOut: vi.fn() }),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const testMerchant: MerchantData = {
  id: 'merchant-1',
  user_id: 'user-123',
  business_name: 'Test Store',
  business_type: 'FASHION',
  slug: 'test-store',
  country: 'NG',
};

const staffAccessOwner: StaffAccess = {
  isStaff: false,
  isOwner: true,
  role: null,
  permissions: { full_access: { all: true } },
};

const staffAccessStaff: StaffAccess = {
  isStaff: true,
  isOwner: false,
  role: 'manager',
  permissions: {
    products: { view: true, edit: true },
    orders: { view: true },
  },
};

describe('useMerchant', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: Return merchant data for owner check + domains query
    const mockOwnerQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { ...testMerchant, feature_settings: null },
        error: null,
      }),
    };

    const mockStaffQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    const mockDomainsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    // Mock from() to return different queries based on table name
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') return mockOwnerQuery;
      if (table === 'staff_members') return mockStaffQuery;
      if (table === 'domains') return mockDomainsQuery;
      return mockOwnerQuery;
    });
  });

  it('throws error when used outside MerchantProvider', () => {
    // Use console.error suppression to avoid test noise
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      // Intentionally empty to suppress error output
    });

    expect(() => {
      renderHook(() => useMerchant());
    }).toThrow('useMerchant must be used within a MerchantProvider');

    consoleError.mockRestore();
  });

  it('returns null when useMerchantSafe is used outside MerchantProvider', () => {
    const { result } = renderHook(() => useMerchantSafe());
    expect(result.current).toBeNull();
  });

  it('initializes with initialMerchant data and loading is false', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MerchantProvider initialMerchant={testMerchant}>
        {children}
      </MerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    // Wait for async effects to settle
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should have merchant data (from DB query or initial prop)
    expect(result.current.merchant).toMatchObject({
      id: testMerchant.id,
      business_name: testMerchant.business_name,
      slug: testMerchant.slug,
    });
  });

  it('sets loading to true when no initialMerchant is provided', async () => {
    // Mock merchant fetch to return data
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { ...testMerchant, feature_settings: null },
        error: null,
      }),
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <MerchantProvider>{children}</MerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    // Loading should be true initially when no initialMerchant
    expect(result.current.loading).toBe(true);

    // Wait for loading to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('hasPermission returns true for owner', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MerchantProvider
        initialMerchant={testMerchant}
        initialStaffAccess={staffAccessOwner}
      >
        {children}
      </MerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasPermission('products', 'edit')).toBe(true);
    expect(result.current.hasPermission('orders', 'delete')).toBe(true);
    expect(result.current.hasPermission('any_resource', 'any_action')).toBe(
      true
    );
  });

  it('hasPermission returns false for staff without permission', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MerchantProvider
        initialMerchant={testMerchant}
        initialStaffAccess={staffAccessStaff}
      >
        {children}
      </MerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    // Staff has view and edit on products, but not delete
    expect(result.current.hasPermission('products', 'delete')).toBe(false);
    // Staff has view on orders, but not edit
    expect(result.current.hasPermission('orders', 'edit')).toBe(false);
  });

  it('hasPermission returns true for staff with matching permission', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MerchantProvider
        initialMerchant={testMerchant}
        initialStaffAccess={staffAccessStaff}
      >
        {children}
      </MerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasPermission('products', 'view')).toBe(true);
    expect(result.current.hasPermission('products', 'edit')).toBe(true);
    expect(result.current.hasPermission('orders', 'view')).toBe(true);
  });

  it('basePath is computed correctly from slug in path mode', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MerchantProvider
        initialMerchant={testMerchant}
        initialRoutingMode="path"
      >
        {children}
      </MerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.basePath).toBe('/test-store');
    expect(result.current.routingMode).toBe('path');
  });

  it('basePath is empty string in domain routing mode', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MerchantProvider
        initialMerchant={testMerchant}
        initialRoutingMode="domain"
      >
        {children}
      </MerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    expect(result.current.basePath).toBe('');
    expect(result.current.routingMode).toBe('domain');
  });

  it('provides staffAccess from initialStaffAccess prop before async load', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MerchantProvider
        initialMerchant={testMerchant}
        initialStaffAccess={staffAccessStaff}
      >
        {children}
      </MerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    // Check initial state (before loadData runs async)
    expect(result.current.staffAccess.isStaff).toBe(true);
    expect(result.current.staffAccess.isOwner).toBe(false);
    expect(result.current.staffAccess.role).toBe('manager');
    expect(result.current.staffAccess.permissions).toEqual({
      products: { view: true, edit: true },
      orders: { view: true },
    });
  });

  it('provides navigationCategories from prop', () => {
    const categories = [
      { id: '1', name: 'Electronics', slug: 'electronics' },
      { id: '2', name: 'Fashion', slug: 'fashion' },
    ];

    const wrapper = ({ children }: { children: ReactNode }) => (
      <MerchantProvider
        initialMerchant={testMerchant}
        navigationCategories={categories}
      >
        {children}
      </MerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    expect(result.current.navigationCategories).toEqual(categories);
  });
});
