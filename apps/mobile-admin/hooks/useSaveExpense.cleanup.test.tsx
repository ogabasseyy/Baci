import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseConflictError } from './useSaveExpense';
import {
  createQueryClient,
  expectedUpdatedAt,
  expenseId,
  insertResponse,
  merchantId,
  originalReceiptPath,
  renderSaveExpense,
  replacementReceiptPath,
  updateResponse,
  validInput,
} from './useSaveExpense.test-fixtures';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  removeOwned: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mocks.from(...args),
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  },
}));

vi.mock('@/lib/expense-receipt', () => ({
  expenseReceiptStorage: {
    removeOwned: (...args: unknown[]) => mocks.removeOwned(...args),
    upload: (...args: unknown[]) => mocks.upload(...args),
  },
}));

describe('useSaveExpense receipt cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.removeOwned.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.upload.mockResolvedValue({ storagePath: replacementReceiptPath });
  });

  it('removes a replacement after a definitive create rejection', async () => {
    mocks.from.mockReturnValue(
      insertResponse({
        data: null,
        error: { code: '23514', message: 'Invalid expense group assignment' },
      })
    );
    const input = {
      ...validInput(),
      receiptChange: { kind: 'replace' as const, localUri: 'file:///new.jpg' },
    };
    const { result } = renderSaveExpense();

    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      'Invalid expense group assignment'
    );
    expect(mocks.removeOwned).toHaveBeenCalledWith(
      merchantId,
      replacementReceiptPath
    );
  });

  it('removes a replacement after a definitive validation rejection', async () => {
    mocks.from.mockReturnValue(
      insertResponse({
        data: null,
        error: { code: '22001', message: 'Expense description is too long' },
      })
    );
    const input = {
      ...validInput(),
      receiptChange: { kind: 'replace' as const, localUri: 'file:///new.jpg' },
    };
    const { result } = renderSaveExpense();

    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      'Expense description is too long'
    );
    expect(mocks.removeOwned).toHaveBeenCalledWith(
      merchantId,
      replacementReceiptPath
    );
  });

  it('removes a replacement after an optimistic-concurrency conflict', async () => {
    mocks.from.mockReturnValue(updateResponse({ data: null, error: null }));
    const input = {
      ...validInput(),
      expectedUpdatedAt,
      expenseId,
      mode: 'edit' as const,
      originalLegacyReceiptUrl: null,
      originalReceiptStoragePath: null,
      receiptChange: { kind: 'replace' as const, localUri: 'file:///new.jpg' },
    };
    const { result } = renderSaveExpense(createQueryClient());

    await expect(result.current.mutateAsync(input)).rejects.toBeInstanceOf(
      ExpenseConflictError
    );
    expect(mocks.removeOwned).toHaveBeenCalledWith(
      merchantId,
      replacementReceiptPath
    );
  });

  it('removes a replacement after a definitive update rejection', async () => {
    mocks.from.mockReturnValue(
      updateResponse({
        data: null,
        error: { code: '23514', message: 'Archived group assignment' },
      })
    );
    const input = {
      ...validInput(),
      expectedUpdatedAt,
      expenseId,
      mode: 'edit' as const,
      originalLegacyReceiptUrl: null,
      originalReceiptStoragePath: null,
      receiptChange: { kind: 'replace' as const, localUri: 'file:///new.jpg' },
    };
    const { result } = renderSaveExpense();

    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      'Archived group assignment'
    );
    expect(mocks.removeOwned).toHaveBeenCalledWith(
      merchantId,
      replacementReceiptPath
    );
  });

  it('retains a replacement when an update outcome is ambiguous', async () => {
    mocks.from.mockReturnValue(
      updateResponse({
        data: null,
        error: { code: '08006', message: 'Connection failure' },
      })
    );
    const input = {
      ...validInput(),
      expectedUpdatedAt,
      expenseId,
      mode: 'edit' as const,
      originalLegacyReceiptUrl: null,
      originalReceiptStoragePath: null,
      receiptChange: { kind: 'replace' as const, localUri: 'file:///new.jpg' },
    };
    const { result } = renderSaveExpense();

    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      'Connection failure'
    );
    expect(mocks.removeOwned).not.toHaveBeenCalledWith(
      merchantId,
      replacementReceiptPath
    );
  });

  it('removes an old owned private object only after a successful update', async () => {
    mocks.from.mockReturnValue(
      updateResponse({
        data: { id: expenseId, updated_at: '2026-08-09T11:00:00.000Z' },
        error: null,
      })
    );
    const input = {
      ...validInput(),
      expectedUpdatedAt,
      expenseId,
      mode: 'edit' as const,
      originalLegacyReceiptUrl: null,
      originalReceiptStoragePath: originalReceiptPath,
      receiptChange: { kind: 'replace' as const, localUri: 'file:///new.jpg' },
    };
    const { result } = renderSaveExpense(createQueryClient());

    await result.current.mutateAsync(input);

    expect(mocks.removeOwned).toHaveBeenCalledWith(
      merchantId,
      originalReceiptPath
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_expense_private_receipt_cleanup',
      expect.anything()
    );
  });

  it('does not call the service-only completion RPC when storage deletion fails after a successful update', async () => {
    mocks.from.mockReturnValue(
      updateResponse({
        data: { id: expenseId, updated_at: '2026-08-09T11:00:00.000Z' },
        error: null,
      })
    );
    const input = {
      ...validInput(),
      expectedUpdatedAt,
      expenseId,
      mode: 'edit' as const,
      originalLegacyReceiptUrl: null,
      originalReceiptStoragePath: originalReceiptPath,
      receiptChange: { kind: 'replace' as const, localUri: 'file:///new.jpg' },
    };
    const { result } = renderSaveExpense(createQueryClient());

    await result.current.mutateAsync(input);

    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_expense_private_receipt_cleanup',
      expect.anything()
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'queue_expense_private_receipt_cleanup',
      expect.anything()
    );
  });

  it('queues unreferenced replacement cleanup when storage removal fails after a create rejection', async () => {
    mocks.removeOwned.mockRejectedValue(new Error('storage offline'));
    mocks.from.mockReturnValue(
      insertResponse({
        data: null,
        error: { code: '23514', message: 'Invalid expense group assignment' },
      })
    );
    const input = {
      ...validInput(),
      receiptChange: { kind: 'replace' as const, localUri: 'file:///new.jpg' },
    };
    const { result } = renderSaveExpense();

    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      'Invalid expense group assignment'
    );

    expect(mocks.rpc).toHaveBeenCalledWith(
      'queue_unreferenced_expense_private_receipt_cleanup',
      {
        p_merchant_id: merchantId,
        p_storage_path: replacementReceiptPath,
      }
    );
  });

  it('queues uploaded receipts before attempting the expense write', async () => {
    mocks.from.mockReturnValue(
      insertResponse({
        data: { id: expenseId, updated_at: expectedUpdatedAt },
        error: null,
      })
    );
    const input = {
      ...validInput(),
      receiptChange: { kind: 'replace' as const, localUri: 'file:///new.jpg' },
    };
    const { result } = renderSaveExpense();

    await result.current.mutateAsync(input);

    expect(mocks.rpc).toHaveBeenCalledWith(
      'queue_unreferenced_expense_private_receipt_cleanup',
      {
        p_merchant_id: merchantId,
        p_storage_path: replacementReceiptPath,
      }
    );
  });

  it('removes an uploaded replacement when pre-write queueing fails', async () => {
    mocks.rpc.mockImplementation((rpcName: string) => {
      if (rpcName === 'queue_unreferenced_expense_private_receipt_cleanup') {
        return Promise.resolve({
          error: { message: 'queue unavailable' },
        });
      }
      return Promise.resolve({ error: null });
    });
    const input = {
      ...validInput(),
      receiptChange: { kind: 'replace' as const, localUri: 'file:///new.jpg' },
    };
    const { result } = renderSaveExpense();

    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      'queue unavailable'
    );
    expect(mocks.removeOwned).toHaveBeenCalledWith(
      merchantId,
      replacementReceiptPath
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
