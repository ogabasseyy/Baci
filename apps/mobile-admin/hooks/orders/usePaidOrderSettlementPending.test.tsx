import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { usePaidOrderSettlementPending } from './usePaidOrderSettlementPending';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({ asyncStorage: storage }));
vi.mock('@/lib/paid-order-amendment-api', () => ({
  verifiedSettlementActionSchema: z.object({
    action: z.literal('record_verified_lender_refund'),
    idempotencyKey: z.uuid(),
  }),
}));

const id = '42778a83-0ed7-4fa5-9e1d-4ea7a085b217';
const payload = {
  action: 'record_verified_lender_refund' as const,
  idempotencyKey: id,
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe('usePaidOrderSettlementPending', () => {
  beforeEach(() => vi.resetAllMocks());

  it('restores a valid saved finance command', async () => {
    storage.getItem
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify(payload));
    const { result } = renderHook(
      () =>
        usePaidOrderSettlementPending({
          operatorId: id,
          orderId: id,
          amendmentId: id,
        }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.savedAction).toEqual(payload));
    expect(result.current.unreadableSavedAction).toBe(false);
  });

  it('marks malformed storage unreadable and clears its invalid command', async () => {
    storage.getItem.mockResolvedValueOnce(null).mockResolvedValueOnce('{bad');
    storage.setItem.mockResolvedValue(undefined);
    storage.removeItem.mockResolvedValue(undefined);
    const { result } = renderHook(
      () =>
        usePaidOrderSettlementPending({
          operatorId: id,
          orderId: id,
          amendmentId: id,
        }),
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.unreadableSavedAction).toBe(true)
    );
    expect(storage.setItem).toHaveBeenCalledWith(
      `${result.current.storageKey}:unreadable`,
      '1'
    );
    expect(storage.removeItem).toHaveBeenCalledWith(result.current.storageKey);
  });

  it('keeps recovery available when the unreadable marker cannot be saved', async () => {
    storage.getItem.mockResolvedValueOnce(null).mockResolvedValueOnce('{}');
    storage.setItem.mockRejectedValue(new Error('storage unavailable'));
    const { result } = renderHook(
      () =>
        usePaidOrderSettlementPending({
          operatorId: id,
          orderId: id,
          amendmentId: id,
        }),
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.unreadableSavedAction).toBe(true)
    );
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
