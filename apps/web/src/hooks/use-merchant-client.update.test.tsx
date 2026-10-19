import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantProvider } from './merchant/merchant-provider';
import type { MerchantData, StaffAccess } from './use-merchant';
import { useMerchant } from './use-merchant-client';

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuthSafe: () => ({
    user: { id: 'user-123', email: 'test@test.com' },
    loading: false,
    signOut: vi.fn(),
  }),
}));

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

function createOwnerWrapper({ children }: { children: ReactNode }) {
  return (
    <MerchantProvider
      initialMerchant={testMerchant}
      initialStaffAccess={staffAccessOwner}
    >
      {children}
    </MerchantProvider>
  );
}

describe('useMerchant updateMerchant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips the Supabase update when only non-writable keys are provided', async () => {
    // Arrange
    const { result } = renderHook(() => useMerchant(), {
      wrapper: createOwnerWrapper,
    });

    // Act
    await result.current.updateMerchant({ id: 'merchant-2' });

    // Assert
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('limits an owner generic update to the captured merchant and user IDs', async () => {
    // Arrange
    const updateQuery = { update: vi.fn(), eq: vi.fn() };
    updateQuery.update.mockReturnValue(updateQuery);
    updateQuery.eq
      .mockReturnValueOnce(updateQuery)
      .mockResolvedValueOnce({ error: null });
    mockFrom.mockReturnValue(updateQuery);
    const { result } = renderHook(() => useMerchant(), {
      wrapper: createOwnerWrapper,
    });

    // Act
    await result.current.updateMerchant(
      { hero_slides: [] },
      { merchantId: 'merchant-1', skipReload: true }
    );

    // Assert
    expect(mockFrom).toHaveBeenCalledWith('merchants');
    expect(updateQuery.eq).toHaveBeenNthCalledWith(1, 'id', 'merchant-1');
    expect(updateQuery.eq).toHaveBeenNthCalledWith(2, 'user_id', 'user-123');
  });
});
