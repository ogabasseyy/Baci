import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { merchant } = vi.hoisted(() => ({ merchant: vi.fn() }));
vi.mock('@/hooks/use-merchant-client', () => ({ useMerchant: merchant }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

import { fetchWithCsrf } from '@/lib/api-client';
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

it.each([
  'VERSION_CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
])('replaces a terminal %s retry ID', async (code) => {
  const post = vi.mocked(fetchWithCsrf);
  post.mockResolvedValue(
    Response.json({ error: 'Use a new connection ID', code }, { status: 409 })
  );
  const { result } = renderHook(() => useMuseConnections());
  await act(async () => {
    await result.current.handleConnect();
  });
  const first = JSON.parse(
    String(post.mock.calls.at(-1)?.[1]?.body)
  ).connectionId;
  await act(async () => {
    await result.current.handleConnect();
  });
  const second = JSON.parse(
    String(post.mock.calls.at(-1)?.[1]?.body)
  ).connectionId;
  expect(second).not.toBe(first);
});
