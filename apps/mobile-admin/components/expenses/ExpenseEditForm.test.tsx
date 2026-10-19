import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  editBranchId,
  editExpense,
  editExpenseId,
  editGroupId,
  editMerchantId,
  getExpenseEditFormMocks,
  resetExpenseEditFormMocks,
} from './ExpenseEditForm.test-fixtures';

const { ExpenseEditForm } = await import('./ExpenseEditForm');

const reload = vi.fn();
const editFormMocks = getExpenseEditFormMocks();

function renderForm(expense = editExpense, canEdit = true) {
  return render(
    <ExpenseEditForm canEdit={canEdit} expense={expense} onReload={reload} />
  );
}

function saveChangedAmount() {
  fireEvent.change(screen.getByLabelText('Expense amount'), {
    target: { value: '5000' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
}

describe('ExpenseEditForm', () => {
  beforeEach(() => {
    resetExpenseEditFormMocks();
    reload.mockReset();
  });

  it('preloads the archived group and the signed private receipt preview', () => {
    renderForm();

    expect(screen.getByLabelText('preloaded amount')).toHaveTextContent('4250');
    expect(
      screen.getByText('Archived marketing (archived)')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('receipt preview')).toHaveTextContent(
      'https://signed.example.com/receipt.jpg'
    );
  });

  it('keeps Save disabled until the preloaded values change', () => {
    renderForm();

    expect(screen.getByRole('button', { name: 'Save expense' })).toBeDisabled();
  });

  it('surfaces branch loading failure with a retry action', () => {
    editFormMocks.branchesData = undefined;
    editFormMocks.branchesError = new Error('branches unavailable');
    renderForm();

    expect(
      screen.getByText('Could not load branches. Please try again.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save expense' })
    ).not.toBeInTheDocument();
  });

  it('keeps the edit form usable when a branch refetch fails with cached data', () => {
    editFormMocks.branchesError = new Error('branches refetch failed');
    renderForm();

    expect(
      screen.queryByText('Could not load branches. Please try again.')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save expense' })).toBeDisabled();
  });

  it('preserves the original group when editing archives that group', async () => {
    editFormMocks.archiveGroup.mockResolvedValue(undefined);
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Choose group' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Archive selected group' })
    );
    await waitFor(() =>
      expect(editFormMocks.archiveGroup).toHaveBeenCalledWith(editGroupId)
    );
    saveChangedAmount();
    expect(editFormMocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({ groupId: editGroupId }),
      }),
      expect.any(Object)
    );
  });

  it('confirms before closing a dirty edit draft', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Expense amount'), {
      target: { value: '5000' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Close edit expense screen' })
    );

    expect(editFormMocks.alert).toHaveBeenCalledWith(
      'Discard changes?',
      'Your unsaved changes will be lost.',
      expect.any(Array)
    );
    expect(editFormMocks.router.back).not.toHaveBeenCalled();
  });

  it('confirms before native Back removes a dirty edit draft', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Expense amount'), {
      target: { value: '5000' },
    });

    expect(editFormMocks.preventRemoveEnabled).toBe(true);
    editFormMocks.preventRemoveCallback?.();

    expect(editFormMocks.alert).toHaveBeenCalledWith(
      'Discard changes?',
      'Your unsaved changes will be lost.',
      expect.any(Array)
    );
  });

  it('saves changed editable values with the original optimistic version', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Expense amount'), {
      target: { value: '5000' },
    });
    fireEvent.change(screen.getByLabelText('Expense description'), {
      target: { value: 'Updated internet subscription' },
    });
    fireEvent.change(screen.getByLabelText('Expense vendor or payee'), {
      target: { value: 'New ISP Ltd' },
    });
    fireEvent.change(screen.getByLabelText('Expense payment method'), {
      target: { value: 'Card' },
    });
    fireEvent.change(screen.getByLabelText('Expense reference'), {
      target: { value: 'INV-102' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));

    expect(editFormMocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedUpdatedAt: editExpense.updated_at,
        expenseId: editExpenseId,
        merchantId: editMerchantId,
        mode: 'edit',
        values: expect.objectContaining({
          amount: 5000,
          branchId: editBranchId,
          description: 'Updated internet subscription',
          paymentMethod: 'Card',
          reference: 'INV-102',
          vendorName: 'New ISP Ltd',
        }),
      }),
      expect.any(Object)
    );
  });

  it('wires receipt removal and restoration into the save payload', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Remove receipt' }));
    expect(screen.getByLabelText('receipt change')).toHaveTextContent('remove');
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(editFormMocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ receiptChange: { kind: 'remove' } }),
      expect.any(Object)
    );
    editFormMocks.mutate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Restore receipt' }));
    expect(screen.getByLabelText('receipt change')).toHaveTextContent(
      'unchanged'
    );

    saveChangedAmount();

    expect(editFormMocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ receiptChange: { kind: 'unchanged' } }),
      expect.any(Object)
    );
  });

  it('keeps legacy receipt previews and wires a replacement through save', async () => {
    editFormMocks.imagePicker.mockResolvedValue({
      assets: [{ uri: 'file:///tmp/replacement.jpg' }],
      canceled: false,
    });
    renderForm({
      ...editExpense,
      receipt_storage_path: null,
      receipt_url: 'https://legacy.example.com/receipt.jpg',
    });

    expect(screen.getByLabelText('receipt preview')).toHaveTextContent(
      'https://legacy.example.com/receipt.jpg'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replace receipt' }));
    await waitFor(() => {
      expect(screen.getByLabelText('receipt change')).toHaveTextContent(
        'replace'
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));

    expect(editFormMocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        receiptChange: {
          kind: 'replace',
          localUri: 'file:///tmp/replacement.jpg',
        },
      }),
      expect.any(Object)
    );
  });

  it('offers conflict Cancel and Reload without treating Cancel as a reload', () => {
    editFormMocks.mutate.mockImplementation(
      (_input: unknown, options?: { onError?: (error: Error) => void }) => {
        const conflict = new Error('stale write');
        conflict.name = 'ExpenseConflictError';
        options?.onError?.(conflict);
      }
    );
    renderForm();

    saveChangedAmount();

    const conflictAlert = editFormMocks.alert.mock.calls.find(
      ([title]) => title === 'Expense changed'
    );
    const actions = conflictAlert?.[2] as
      | Array<{ onPress?: () => void; text: string }>
      | undefined;
    actions?.find((action) => action.text === 'Cancel')?.onPress?.();
    expect(reload).not.toHaveBeenCalled();
    actions?.find((action) => action.text === 'Reload')?.onPress?.();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('returns to the detail screen after a successful edit', () => {
    renderForm();

    saveChangedAmount();

    expect(editFormMocks.router.back).toHaveBeenCalledOnce();
  });

  it('shows a retained legacy category instead of a false Inventory selection', () => {
    renderForm({ ...editExpense, category: 'Legacy category' });

    expect(screen.getByLabelText('selected category')).toHaveTextContent(
      'Legacy category'
    );
  });
});
