import { Alert } from 'react-native';
import type { ExpenseReceiptChange } from '@/hooks/useExpenseFormState';
import type { useSaveExpense } from '@/hooks/useSaveExpense';
import type { ExpenseDetail } from '@/schemas/expense-detail';
import {
  createExpenseEditFormSchema,
  type ExpenseEditFormDraft,
} from '@/schemas/expense-form';

interface ExpenseEditFormSaveState {
  expectedUpdatedAt: string | null;
  originalLegacyReceiptUrl: string | null;
  originalReceiptStoragePath: string | null;
  receiptChange: ExpenseReceiptChange;
  values: ExpenseEditFormDraft;
}

type SaveExpenseMutation = ReturnType<typeof useSaveExpense>;

interface ActiveExpenseGroup {
  id: string;
}

interface ActiveBranch {
  active: boolean;
  id: string;
}

interface SubmitExpenseEditInput {
  activeGroups: ActiveExpenseGroup[];
  branches?: ActiveBranch[];
  expense: ExpenseDetail & { amountWasLegacySpecial?: boolean };
  form: ExpenseEditFormSaveState;
  merchantId: string;
  onReload: () => void;
  onSuccess: () => void;
  originalGroupId: string | null;
  saveExpense: SaveExpenseMutation;
  selectedBranchId: string | null;
}

export function submitExpenseEdit({
  activeGroups,
  branches,
  expense,
  form,
  merchantId,
  onReload,
  onSuccess,
  originalGroupId,
  saveExpense,
  selectedBranchId,
}: SubmitExpenseEditInput): void {
  const parsed = createExpenseEditFormSchema(
    expense.description,
    expense.category,
    expense.amount,
    expense.branch_id
  ).safeParse({
    ...form.values,
    branchId: selectedBranchId,
  });

  if (!parsed.success) {
    Alert.alert('Complete required fields', 'Enter a valid amount and branch.');
    return;
  }

  if (
    selectedBranchId !== expense.branch_id &&
    selectedBranchId !== null &&
    branches &&
    !branches.some((branch) => branch.id === selectedBranchId && branch.active)
  ) {
    Alert.alert('Branch unavailable', 'Choose an active branch before saving.');
    return;
  }

  if (
    parsed.data.groupId !== originalGroupId &&
    parsed.data.groupId !== null &&
    !activeGroups.some(({ id }) => id === parsed.data.groupId)
  ) {
    Alert.alert('Group unavailable', 'Choose an active group before saving.');
    return;
  }

  saveExpense.mutate(
    {
      expectedUpdatedAt: form.expectedUpdatedAt ?? expense.updated_at,
      expenseId: expense.id,
      merchantId,
      mode: 'edit',
      originalAmount: expense.amount,
      amountWasLegacySpecial: expense.amountWasLegacySpecial,
      originalBranchId: expense.branch_id,
      originalCategory: expense.category,
      originalDescription: expense.description,
      originalLegacyReceiptUrl: form.originalLegacyReceiptUrl,
      originalReceiptStoragePath: form.originalReceiptStoragePath,
      receiptChange: form.receiptChange,
      values: parsed.data,
    },
    {
      onError: (error) => {
        if (error instanceof Error && error.name === 'ExpenseConflictError') {
          Alert.alert(
            'Expense changed',
            'This expense changed elsewhere. Reload it before saving again.',
            [{ text: 'Cancel' }, { onPress: onReload, text: 'Reload' }]
          );
          return;
        }
        Alert.alert('Could not save expense', 'Please try again.');
      },
      onSuccess,
    }
  );
}
