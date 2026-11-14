import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOrderFulfillAccess } from './useOrderFulfillAccess';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';
const otherMerchantId = '8195ad88-0a9f-42ba-a18f-0db9ae9fc012';

const mocks = vi.hoisted(() => ({
  user: { id: 'staff-1' } as { id: string } | null,
  merchant: null as { id: string; user_id: string } | null,
  rpc: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: mocks.merchant }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mocks.rpc(...args) },
}));

function staffRow(permissions: unknown, rowMerchantId = merchantId) {
  return {
    is_owner: false,
    is_staff: true,
    merchant_id: rowMerchantId,
    permissions,
    role: 'fulfillment',
  };
}

function renderAccess() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const queryKey = ['order-fulfill-access', mocks.user?.id, mocks.merchant?.id];
  const settled = () => queryClient.getQueryState(queryKey)?.status;
  return {
    ...renderHook(() => useOrderFulfillAccess(), { wrapper }),
    settled,
  };
}

describe('useOrderFulfillAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: 'staff-1' };
    mocks.merchant = { id: merchantId, user_id: 'owner-1' };
  });

  it('lets the owner fulfil and edit at once without asking the server', () => {
    mocks.user = { id: 'owner-1' };

    const { result } = renderAccess();

    expect(result.current).toEqual({ canFulfill: true, canEdit: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('resolves staff order grants from get_user_access', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [staffRow({ orders: { view: true, fulfill: true } })],
      error: null,
    });

    const { result } = renderAccess();

    await waitFor(() => expect(result.current.canFulfill).toBe(true));
    expect(result.current.canEdit).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith('get_user_access');
  });

  it('stays closed while the staff grants are loading', () => {
    mocks.rpc.mockReturnValueOnce(new Promise(() => undefined));

    const { result } = renderAccess();

    expect(result.current).toEqual({ canFulfill: false, canEdit: false });
  });

  it('denies staff when the access row belongs to another merchant', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [staffRow({ '*': { '*': true } }, otherMerchantId)],
      error: null,
    });

    const { result, settled } = renderAccess();

    await waitFor(() => expect(settled()).toBe('success'));
    expect(result.current).toEqual({ canFulfill: false, canEdit: false });
  });

  it.each([
    ['an RPC error', { data: null, error: { message: 'boom' } }],
    ['an invalid response', { data: [{ merchant_id: 'x' }], error: null }],
  ])('denies staff on %s', async (_label, response) => {
    mocks.rpc.mockResolvedValueOnce(response);

    const { result, settled } = renderAccess();

    await waitFor(() => expect(settled()).toBe('error'));
    expect(result.current).toEqual({ canFulfill: false, canEdit: false });
  });

  it('does not ask the server before a user and merchant are known', () => {
    mocks.merchant = null;

    const { result } = renderAccess();

    expect(result.current).toEqual({ canFulfill: false, canEdit: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
