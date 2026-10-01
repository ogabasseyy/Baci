import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExpenseFormState } from './useExpenseFormState';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';
const branchId = '8b3f1444-8890-4b6a-a00f-ae80949f05b2';
const groupId = 'f4067728-3048-4f49-a6c2-0d6b891c43d7';

describe('useExpenseFormState', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 9, 11, 0));
  });

  it('creates a new editable draft with local date defaults and no receipt change', () => {
    const { result } = renderHook(() =>
      useExpenseFormState({ initialBranchId: branchId })
    );

    expect(result.current.values).toMatchObject({
      amount: 0,
      branchId,
      date: '2026-08-09',
      description: null,
      groupId: null,
      paymentMethod: null,
      reference: null,
      vendorName: null,
    });
    expect(result.current.receiptChange).toEqual({ kind: 'unchanged' });
    expect(result.current.isDirty).toBe(false);
  });

  it('preloads edit values and tracks editable field changes', () => {
    const { result } = renderHook(() =>
      useExpenseFormState({
        initialBranchId: branchId,
        initialValues: {
          amount: 4250,
          branchId,
          category: 'Utilities',
          date: '2026-08-08',
          description: 'Internet subscription',
          groupId,
          paymentMethod: 'Transfer',
          reference: 'INV-101',
          vendorName: 'ISP Ltd',
        },
      })
    );

    act(() => result.current.setField('amount', 5000));

    expect(result.current.values).toMatchObject({
      amount: 5000,
      groupId,
      reference: 'INV-101',
    });
    expect(result.current.isDirty).toBe(true);
  });

  it('does not let generic field updates mutate receipt persistence state', () => {
    const originalStoragePath = `${merchantId}/expenses/original.jpg`;
    const { result } = renderHook(() =>
      useExpenseFormState({
        initialBranchId: branchId,
        originalReceiptStoragePath: originalStoragePath,
      })
    );

    act(() => {
      (result.current.setField as (field: string, value: unknown) => void)(
        'receiptStoragePath',
        `${merchantId}/expenses/forged.jpg`
      );
    });

    expect(result.current.originalReceiptStoragePath).toBe(originalStoragePath);
    expect(result.current.receiptChange).toEqual({ kind: 'unchanged' });
    expect(result.current.values).not.toHaveProperty('receiptStoragePath');
  });

  it('makes receipt removal reversible while retaining the original receipt identities', () => {
    const originalLegacyReceiptUrl = 'https://legacy.example.com/receipt.jpg';
    const originalReceiptStoragePath = `${merchantId}/expenses/original.jpg`;
    const { result } = renderHook(() =>
      useExpenseFormState({
        initialBranchId: branchId,
        originalLegacyReceiptUrl,
        originalReceiptStoragePath,
      })
    );

    act(() => result.current.removeReceipt());
    expect(result.current.receiptChange).toEqual({ kind: 'remove' });
    expect(result.current.receiptPreviewUri).toBeNull();
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.setLocalReceipt('file:///documents/new.jpg'));
    expect(result.current.receiptChange).toEqual({
      kind: 'replace',
      localUri: 'file:///documents/new.jpg',
    });
    expect(result.current.receiptPreviewUri).toBe('file:///documents/new.jpg');

    act(() => result.current.reset());
    expect(result.current.receiptChange).toEqual({ kind: 'unchanged' });
    expect(result.current.originalLegacyReceiptUrl).toBe(
      originalLegacyReceiptUrl
    );
    expect(result.current.originalReceiptStoragePath).toBe(
      originalReceiptStoragePath
    );
    expect(result.current.receiptPreviewUri).toBe(originalLegacyReceiptUrl);
    expect(result.current.isDirty).toBe(false);
  });

  it('restores the original receipt without resetting other edited expense fields', () => {
    const originalLegacyReceiptUrl = 'https://legacy.example.com/receipt.jpg';
    const { result } = renderHook(() =>
      useExpenseFormState({
        initialBranchId: branchId,
        originalLegacyReceiptUrl,
      })
    );

    act(() => result.current.setField('vendorName', 'ISP Ltd'));
    act(() => result.current.removeReceipt());
    act(() => result.current.restoreReceipt());

    expect(result.current.receiptChange).toEqual({ kind: 'unchanged' });
    expect(result.current.receiptPreviewUri).toBe(originalLegacyReceiptUrl);
    expect(result.current.values.vendorName).toBe('ISP Ltd');
    expect(result.current.isDirty).toBe(true);
  });

  it('preserves explicit null branch IDs in edit snapshots', () => {
    const { result } = renderHook(() =>
      useExpenseFormState({
        initialValues: {
          amount: 100,
          branchId: null,
          category: 'Inventory',
          date: '2026-08-09',
          description: null,
          groupId: null,
          paymentMethod: null,
          reference: null,
          vendorName: null,
        },
      })
    );

    expect(result.current.values.branchId).toBeNull();
    expect(result.current.isDirty).toBe(false);
  });

  it('returns to unchanged when removing a newly selected receipt from a new expense', () => {
    const { result } = renderHook(() =>
      useExpenseFormState({ initialBranchId: branchId })
    );

    act(() => result.current.setLocalReceipt('file:///documents/new.jpg'));
    act(() => result.current.removeReceipt());

    expect(result.current.receiptChange).toEqual({ kind: 'unchanged' });
    expect(result.current.receiptPreviewUri).toBeNull();
  });
});
