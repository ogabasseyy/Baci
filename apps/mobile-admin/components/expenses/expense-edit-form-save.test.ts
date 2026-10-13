import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitExpenseEdit } from './expense-edit-form-save';

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
}));

const expense = {
  amount: 100,
  branch_id: '8b3f1444-8890-4b6a-a00f-ae80949f05b2',
  category: 'Inventory',
  created_by_user_id: null,
  date: '2026-08-09',
  description: null,
  group_id: null,
  id: '6d89c8af-7bef-4b78-a7b5-9c2a63f691e9',
  merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
  payment_method: null,
  receipt_storage_path: null,
  receipt_url: null,
  reference: null,
  updated_at: '2026-08-09T12:00:00.000Z',
  updated_by_user_id: null,
  vendor_name: null,
};

describe('submitExpenseEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not mutate when validation fails', () => {
    const mutate = vi.fn();
    submitExpenseEdit({
      activeGroups: [],
      expense,
      form: {
        expectedUpdatedAt: expense.updated_at,
        originalLegacyReceiptUrl: null,
        originalReceiptStoragePath: null,
        receiptChange: { kind: 'unchanged' },
        values: {
          amount: 0,
          branchId: null,
          category: 'Inventory',
          date: '2026-08-09',
          description: null,
          groupId: null,
          paymentMethod: null,
          reference: null,
          vendorName: null,
        },
      },
      merchantId: expense.merchant_id,
      onReload: vi.fn(),
      onSuccess: vi.fn(),
      originalGroupId: null,
      saveExpense: { mutate } as never,
      selectedBranchId: null,
    });

    expect(mutate).not.toHaveBeenCalled();
  });

  it('blocks save when a newly selected group was archived concurrently', () => {
    const mutate = vi.fn();
    const archivedGroupId = 'f4067728-3048-4f49-a6c2-0d6b891c43d7';

    submitExpenseEdit({
      activeGroups: [],
      expense,
      form: {
        expectedUpdatedAt: expense.updated_at,
        originalLegacyReceiptUrl: null,
        originalReceiptStoragePath: null,
        receiptChange: { kind: 'unchanged' },
        values: {
          amount: 100,
          branchId: expense.branch_id,
          category: 'Inventory',
          date: '2026-08-09',
          description: null,
          groupId: archivedGroupId,
          paymentMethod: null,
          reference: null,
          vendorName: null,
        },
      },
      merchantId: expense.merchant_id,
      onReload: vi.fn(),
      onSuccess: vi.fn(),
      originalGroupId: null,
      saveExpense: { mutate } as never,
      selectedBranchId: expense.branch_id,
    });

    expect(mutate).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Group unavailable',
      'Choose an active group before saving.'
    );
  });

  it('blocks save when a newly selected branch was deactivated concurrently', () => {
    const mutate = vi.fn();
    const inactiveBranchId = '9b3f1444-8890-4b6a-a00f-ae80949f05b9';

    submitExpenseEdit({
      activeGroups: [],
      branches: [
        { active: false, id: inactiveBranchId },
        { active: true, id: expense.branch_id },
      ],
      expense,
      form: {
        expectedUpdatedAt: expense.updated_at,
        originalLegacyReceiptUrl: null,
        originalReceiptStoragePath: null,
        receiptChange: { kind: 'unchanged' },
        values: {
          amount: 100,
          branchId: inactiveBranchId,
          category: 'Inventory',
          date: '2026-08-09',
          description: null,
          groupId: null,
          paymentMethod: null,
          reference: null,
          vendorName: null,
        },
      },
      merchantId: expense.merchant_id,
      onReload: vi.fn(),
      onSuccess: vi.fn(),
      originalGroupId: null,
      saveExpense: { mutate } as never,
      selectedBranchId: inactiveBranchId,
    });

    expect(mutate).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Branch unavailable',
      'Choose an active branch before saving.'
    );
  });

  it('allows save when historical branch is unchanged even if inactive', () => {
    const mutate = vi.fn();

    submitExpenseEdit({
      activeGroups: [],
      branches: [{ active: false, id: expense.branch_id }],
      expense,
      form: {
        expectedUpdatedAt: expense.updated_at,
        originalLegacyReceiptUrl: null,
        originalReceiptStoragePath: null,
        receiptChange: { kind: 'unchanged' },
        values: {
          amount: 100,
          branchId: expense.branch_id,
          category: 'Inventory',
          date: '2026-08-09',
          description: 'Updated note',
          groupId: null,
          paymentMethod: null,
          reference: null,
          vendorName: null,
        },
      },
      merchantId: expense.merchant_id,
      onReload: vi.fn(),
      onSuccess: vi.fn(),
      originalGroupId: null,
      saveExpense: { mutate } as never,
      selectedBranchId: expense.branch_id,
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
