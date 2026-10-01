import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseConflictError, type SaveExpenseInput } from './useSaveExpense';
import {
  branchId,
  createQueryClient,
  expectedUpdatedAt,
  expenseId,
  groupId,
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

describe('useSaveExpense', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.removeOwned.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.upload.mockResolvedValue({
      storagePath: replacementReceiptPath,
    });
  });

  it('creates a validated expense with branch, group, and metadata fields then invalidates expense caches', async () => {
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const expenses = insertResponse({
      data: { id: expenseId, updated_at: expectedUpdatedAt },
      error: null,
    });
    mocks.from.mockReturnValue(expenses);
    const { result } = renderSaveExpense(queryClient);

    await result.current.mutateAsync(validInput());

    expect(mocks.from).toHaveBeenCalledWith('expenses');
    expect(expenses.insert).toHaveBeenCalledWith({
      amount: 4250,
      branch_id: branchId,
      category: 'Utilities',
      date: '2026-08-09',
      description: 'Internet subscription',
      group_id: groupId,
      merchant_id: merchantId,
      payment_method: 'Transfer',
      receipt_storage_path: null,
      receipt_url: null,
      reference: 'INV-101',
      vendor_name: 'ISP Ltd',
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['expenses', merchantId],
    });
  });

  it('creates an expense without selecting a returned row for create-only callers', async () => {
    const expenses = insertResponse({
      data: null,
      error: null,
    });
    mocks.from.mockReturnValue(expenses);
    const { result } = renderSaveExpense();

    await result.current.mutateAsync(validInput());

    expect(expenses.insert).toHaveBeenCalledWith(
      expect.objectContaining({ merchant_id: merchantId })
    );
  });
  it('rejects invalid form values and receipt persistence fields before uploading or writing', async () => {
    const invalidAmount = validInput();
    invalidAmount.values.amount = 0;
    const withForgedReceipt = {
      ...validInput(),
      values: {
        ...validInput().values,
        receipt_storage_path: `${merchantId}/expenses/forged.jpg`,
      },
    } as unknown as SaveExpenseInput;
    const withForgedOriginalPath = {
      ...validInput(),
      originalReceiptStoragePath: `${merchantId}/expenses/forged.jpg`,
    } as unknown as SaveExpenseInput;
    const { result } = renderSaveExpense();

    await expect(result.current.mutateAsync(invalidAmount)).rejects.toThrow(
      /greater than 0|positive|too small/i
    );
    await expect(result.current.mutateAsync(withForgedReceipt)).rejects.toThrow(
      /unrecognized key/i
    );
    await expect(
      result.current.mutateAsync(withForgedOriginalPath)
    ).rejects.toThrow(/unrecognized key/i);

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('rejects a caller-supplied original private path outside the active merchant folder', async () => {
    const input: SaveExpenseInput = {
      ...validInput(),
      expectedUpdatedAt,
      expenseId,
      mode: 'edit',
      originalLegacyReceiptUrl: null,
      originalReceiptStoragePath: 'other-merchant/expenses/forged.jpg',
    };
    const { result } = renderSaveExpense();

    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      'Receipt path is not owned by the active merchant'
    );

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('rejects a traversal-shaped original private path before writing', async () => {
    const input: SaveExpenseInput = {
      ...validInput(),
      expectedUpdatedAt,
      expenseId,
      mode: 'edit',
      originalLegacyReceiptUrl: null,
      originalReceiptStoragePath: `${merchantId}/expenses/../forged.jpg`,
    };
    const { result } = renderSaveExpense();

    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      'Receipt path is not owned by the active merchant'
    );

    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rejects non-HTTPS and malformed legacy URLs before writing an unchanged receipt', async () => {
    const { result } = renderSaveExpense();

    for (const originalLegacyReceiptUrl of [
      'http://legacy.example.com/receipt.jpg',
      'not a receipt URL',
    ]) {
      const input: SaveExpenseInput = {
        ...validInput(),
        expectedUpdatedAt,
        expenseId,
        mode: 'edit',
        originalLegacyReceiptUrl,
        originalReceiptStoragePath: null,
      };

      await expect(result.current.mutateAsync(input)).rejects.toThrow();
    }

    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('retains a replacement when the database write outcome is ambiguous', async () => {
    mocks.from.mockReturnValue(
      insertResponse({ data: null, error: { message: 'Database unavailable' } })
    );
    const replacement = {
      ...validInput(),
      receiptChange: { kind: 'replace' as const, localUri: 'file:///new.jpg' },
    };
    const { result } = renderSaveExpense();

    await expect(result.current.mutateAsync(replacement)).rejects.toThrow(
      'Database unavailable'
    );

    expect(mocks.upload).toHaveBeenCalledWith(merchantId, 'file:///new.jpg', {
      fileName: undefined,
      mimeType: undefined,
    });
    expect(mocks.removeOwned).not.toHaveBeenCalledWith(
      merchantId,
      replacementReceiptPath
    );
  });

  it('uses id, merchant, and updated_at for an edit conflict and never deletes the legacy receipt URL', async () => {
    const expenses = updateResponse({ data: null, error: null });
    mocks.from.mockReturnValue(expenses);
    const input: SaveExpenseInput = {
      ...validInput(),
      mode: 'edit',
      expenseId,
      expectedUpdatedAt,
      originalLegacyReceiptUrl: 'https://legacy.example.com/receipt.jpg',
      originalReceiptStoragePath: null,
      receiptChange: { kind: 'remove' },
    };
    const { result } = renderSaveExpense();

    await expect(result.current.mutateAsync(input)).rejects.toBeInstanceOf(
      ExpenseConflictError
    );

    expect(expenses.update).toHaveBeenCalledWith(
      expect.objectContaining({ receipt_storage_path: null, receipt_url: null })
    );
    const query = expenses.update.mock.results[0]?.value;
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', expenseId);
    expect(query.eq).toHaveBeenNthCalledWith(2, 'merchant_id', merchantId);
    expect(query.eq).toHaveBeenNthCalledWith(
      3,
      'updated_at',
      expectedUpdatedAt
    );
    expect(query.select).toHaveBeenCalledWith('id, updated_at');
    expect(mocks.removeOwned).not.toHaveBeenCalled();
  });

  it('removes an old owned private object only after a successful update', async () => {
    const oldStoragePath = originalReceiptPath;
    const expenses = updateResponse({
      data: { id: expenseId, updated_at: '2026-08-09T11:00:00.000Z' },
      error: null,
    });
    mocks.from.mockReturnValue(expenses);
    const input: SaveExpenseInput = {
      ...validInput(),
      mode: 'edit',
      expenseId,
      expectedUpdatedAt,
      originalLegacyReceiptUrl: null,
      originalReceiptStoragePath: oldStoragePath,
      receiptChange: { kind: 'replace', localUri: 'file:///new.jpg' },
    };
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderSaveExpense(queryClient);

    await result.current.mutateAsync(input);

    expect(mocks.removeOwned).toHaveBeenCalledWith(merchantId, oldStoragePath);
    expect(mocks.removeOwned).not.toHaveBeenCalledWith(
      merchantId,
      'https://legacy.example.com/receipt.jpg'
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['expense', merchantId],
    });
  });

  it('omits branch_id from edit updates when the historical branch was unassigned and unchanged', async () => {
    const expenses = updateResponse({
      data: { id: expenseId, updated_at: '2026-08-09T11:00:00.000Z' },
      error: null,
    });
    mocks.from.mockReturnValue(expenses);
    const input: SaveExpenseInput = {
      ...validInput(),
      expectedUpdatedAt,
      expenseId,
      mode: 'edit',
      originalBranchId: null,
      originalLegacyReceiptUrl: null,
      originalReceiptStoragePath: null,
      values: {
        ...validInput().values,
        branchId: null,
      },
    };
    const { result } = renderSaveExpense();

    await result.current.mutateAsync(input);

    expect(expenses.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ branch_id: expect.anything() })
    );
  });

  it('uses the parsed cleanup context when caller variables mutate before an edit resolves', async () => {
    let resolveUpdate: (value: unknown) => void = () => undefined;
    const updateResult = new Promise<unknown>((resolve) => {
      resolveUpdate = resolve;
    });
    const expenses = updateResponse(updateResult);
    mocks.from.mockReturnValue(expenses);
    const input: SaveExpenseInput = {
      ...validInput(),
      expectedUpdatedAt,
      expenseId,
      mode: 'edit',
      originalLegacyReceiptUrl: null,
      originalReceiptStoragePath: originalReceiptPath,
      receiptChange: { kind: 'remove' },
    };
    const { result } = renderSaveExpense();

    const saving = result.current.mutateAsync(input);
    await waitFor(() => expect(expenses.update).toHaveBeenCalledTimes(1));
    input.merchantId = 'c7782a7e-a591-4c70-a80c-4771e93d474';
    input.originalReceiptStoragePath =
      'c7782a7e-a591-4c70-a80c-4771e93d474/expenses/7df4f00d-25b9-4103-8c4e-b2724d498d31.jpg';
    resolveUpdate({
      data: { id: expenseId, updated_at: '2026-08-09T11:00:00.000Z' },
      error: null,
    });

    await saving;

    expect(mocks.removeOwned).toHaveBeenCalledWith(
      merchantId,
      originalReceiptPath
    );
  });
});
