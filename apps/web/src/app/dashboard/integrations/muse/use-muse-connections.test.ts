import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { merchant } = vi.hoisted(() => ({ merchant: vi.fn() }));
vi.mock('@/hooks/use-merchant-client', () => ({ useMerchant: merchant }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

import { useMuseConnections } from './use-muse-connections';

beforeEach(() => {
  merchant.mockReturnValue({
    merchant: { id: 'merchant-a' },
    loading: false,
    staffAccess: { isOwner: true },
  });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ connections: [], branches: [] })
      )
  );
});
afterEach(() => vi.unstubAllGlobals());
it('never loads owner connection data for a staff account', () => {
  merchant.mockReturnValue({
    merchant: { id: 'merchant-a' },
    loading: false,
    staffAccess: { isOwner: false },
  });
  const { result } = renderHook(() => useMuseConnections());
  expect(result.current.isOwner).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it('loads owner status and keeps selected scopes unique', async () => {
  const { result } = renderHook(() => useMuseConnections());
  await waitFor(() =>
    expect(result.current.status).toEqual({ connections: [], branches: [] })
  );
  act(() => {
    result.current.toggleScope('orders:read', true);
    result.current.toggleScope('orders:read', true);
  });
  expect(
    result.current.scopes.filter((scope) => scope === 'orders:read')
  ).toHaveLength(1);
});
