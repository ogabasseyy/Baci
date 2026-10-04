import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { useToast } from '@/hooks/use-toast';
import { useJumiaChannelActions } from './use-jumia-channel-actions';

const mockToast = Object.assign(vi.fn(), {
  promise: vi.fn(),
}) as ReturnType<typeof useToast>['toast'];

vi.mock('./use-jumia-integrations', () => ({
  syncOrders: vi.fn().mockResolvedValue({ ok: true, message: 'Synced' }),
  syncStock: vi.fn().mockResolvedValue({ ok: true, message: 'Stock synced' }),
  checkProductApprovals: vi
    .fn()
    .mockResolvedValue({ ok: true, message: 'Checked' }),
}));

describe('useJumiaChannelActions', () => {
  it('syncs orders and refetches on success', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useJumiaChannelActions({ refetch, toast: mockToast })
    );

    await act(async () => {
      await result.current.handleSync('integration-1');
    });

    expect(mockToast).toHaveBeenCalledWith({ title: 'Synced' });
    expect(refetch).toHaveBeenCalled();
  });
});
