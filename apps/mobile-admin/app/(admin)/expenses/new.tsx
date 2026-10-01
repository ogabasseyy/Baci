import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable } from 'react-native';
import { AddExpenseFooter } from '@/components/expenses/AddExpenseFooter';
import { ExpenseCategorySheet } from '@/components/expenses/ExpenseCategorySheet';
import { ExpenseFormFields } from '@/components/expenses/ExpenseFormFields';
import { ExpenseGroupManagerSheet } from '@/components/expenses/ExpenseGroupManagerSheet';
import { ExpenseStatusShell } from '@/components/expenses/ExpenseStatusShell';
import {
  type ExpenseCategory,
  toExpenseCategoryOrNull,
} from '@/components/expenses/expense-categories';
import { isFatalDependencyError } from '@/components/expenses/expense-edit-form-dependencies';
import { expenseFormStyles } from '@/components/expenses/expense-form.styles';
import { AppFormScreen } from '@/components/ui/AppFormScreen';
import { SPACING } from '@/constants/theme';
import { useBranches } from '@/hooks/useBranches';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useExpenseAccess } from '@/hooks/useExpenseAccess';
import { useExpenseFormHandlers } from '@/hooks/useExpenseFormHandlers';
import { useExpenseFormState } from '@/hooks/useExpenseFormState';
import { useExpenseGroups } from '@/hooks/useExpenseGroups';
import { useMerchant } from '@/hooks/useMerchant';
import { useSaveExpense } from '@/hooks/useSaveExpense';
import { useTheme } from '@/hooks/useTheme';
import { parseExpenseAmount } from '@/lib/expense-amount';
import { CreateExpenseFormSchema } from '@/schemas/expense-form';

function AddExpenseForm({
  canEdit,
  isRefreshing,
}: {
  canEdit: boolean;
  isRefreshing: boolean;
}) {
  const { colors } = useTheme();
  const { merchant } = useMerchant();
  const { scope } = useBranchScope();
  const {
    data: branchesData,
    error: branchesError,
    isLoading: branchesLoading,
    refetch: refetchBranches,
  } = useBranches();
  const {
    activeGroups,
    allGroups,
    archiveGroup: archiveGroupMutation,
    createGroup,
    hasCachedGroups,
    renameGroup,
    error: groupsError,
    refetch: refetchGroups,
  } = useExpenseGroups();
  const branches = branchesData ?? [];
  const fatalBranchesError = isFatalDependencyError(
    branchesError,
    branchesData !== undefined
  );
  const fatalGroupsError = isFatalDependencyError(groupsError, hasCachedGroups);
  const saveExpense = useSaveExpense();
  const router = useRouter();
  const activeBranches = branches.filter((branch) => branch.active);
  const defaultBranchId =
    activeBranches.find((branch) => branch.is_default)?.id ??
    activeBranches[0]?.id ??
    '';
  const initialBranchId =
    scope.type === 'branch' &&
    activeBranches.some(({ id }) => id === scope.branchId)
      ? scope.branchId
      : defaultBranchId;
  const form = useExpenseFormState({ initialBranchId });
  const [amountText, setAmountText] = useState('');
  const [categorySheetVisible, setCategorySheetVisible] = useState(false);
  const [groupManagerVisible, setGroupManagerVisible] = useState(false);

  useEffect(() => {
    if (
      scope.type === 'all' &&
      !form.values.branchId &&
      defaultBranchId &&
      !form.isDirty
    ) {
      form.reset({ initialBranchId: defaultBranchId });
    }
  }, [
    defaultBranchId,
    form.isDirty,
    form.reset,
    form.values.branchId,
    scope.type,
  ]);

  const selectedBranchId =
    scope.type === 'branch' ? scope.branchId : form.values.branchId;
  const selectedCategory = toExpenseCategoryOrNull(form.values.category);
  const disabled = saveExpense.isPending || branchesLoading || isRefreshing;
  const { archiveGroup, close, navigateBackAfterSave, pickReceipt } =
    useExpenseFormHandlers({
      archiveGroupMutation,
      form,
      onNavigateBack: router.back,
    });
  if (fatalBranchesError) {
    return (
      <ExpenseStatusShell
        colors={colors}
        errorMessage="Could not load branches. Please try again."
        onRetry={() => void refetchBranches()}
        status="error"
      />
    );
  }
  if (fatalGroupsError) {
    return (
      <ExpenseStatusShell
        colors={colors}
        errorMessage="Could not load expense groups. Please try again."
        onRetry={() => void refetchGroups()}
        status="error"
      />
    );
  }
  const save = () => {
    if (!merchant?.id) return;

    if (
      scope.type === 'all' &&
      !activeBranches.some(({ id }) => id === selectedBranchId)
    ) {
      Alert.alert(
        'Branch unavailable',
        'Choose an active branch before saving.'
      );
      return;
    }

    if (
      form.values.groupId &&
      !activeGroups.some(({ id }) => id === form.values.groupId)
    ) {
      Alert.alert('Group unavailable', 'Choose an active group before saving.');
      return;
    }

    const values = {
      ...form.values,
      branchId: selectedBranchId,
    };
    const parsed = CreateExpenseFormSchema.safeParse(values);
    if (!parsed.success) {
      Alert.alert(
        'Complete required fields',
        'Enter a valid amount and branch.'
      );
      return;
    }

    saveExpense.mutate(
      {
        merchantId: merchant.id,
        mode: 'create',
        receiptChange: form.receiptChange,
        values: parsed.data,
      },
      {
        onError: () =>
          Alert.alert('Could not save expense', 'Please try again.'),
        onSuccess: navigateBackAfterSave,
      }
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable
              accessibilityLabel="Close add expense screen"
              accessibilityRole="button"
              onPress={close}
              style={{ padding: SPACING.sm }}
            >
              <Ionicons color={colors.text} name="close" size={24} />
            </Pressable>
          ),
          title: 'Add Expense',
        }}
      />
      <AppFormScreen
        contentContainerStyle={expenseFormStyles.content}
        edges={['bottom']}
        footer={
          <AddExpenseFooter
            busy={saveExpense.isPending}
            colors={colors}
            disabled={disabled}
            onSave={save}
          />
        }
        style={{ backgroundColor: colors.background }}
      >
        <ExpenseFormFields
          activeGroups={activeGroups}
          amount={amountText}
          branches={scope.type === 'all' ? activeBranches : undefined}
          canEditGroups={canEdit}
          date={form.values.date}
          description={form.values.description ?? ''}
          disabled={disabled}
          existingReceiptUri={null}
          onAmountChange={(value) => {
            setAmountText(value);
            form.setField('amount', parseExpenseAmount(value));
          }}
          onBranchChange={(branchId) => form.setField('branchId', branchId)}
          onDateChange={(date) => form.setField('date', date)}
          onDescriptionChange={(description) =>
            form.setField('description', description || null)
          }
          onGroupChange={(groupId) => form.setField('groupId', groupId)}
          onManageGroups={() => setGroupManagerVisible(true)}
          onOpenCategorySheet={() => setCategorySheetVisible(true)}
          onPaymentMethodChange={(paymentMethod) =>
            form.setField('paymentMethod', paymentMethod || null)
          }
          onReceiptPress={() => {
            void pickReceipt();
          }}
          onReceiptRemove={form.removeReceipt}
          onReceiptRestore={form.restoreReceipt}
          onReferenceChange={(reference) =>
            form.setField('reference', reference || null)
          }
          onVendorNameChange={(vendorName) =>
            form.setField('vendorName', vendorName || null)
          }
          paymentMethod={form.values.paymentMethod ?? ''}
          receiptChange={form.receiptChange}
          receiptUri={form.receiptPreviewUri}
          reference={form.values.reference ?? ''}
          selectedBranchId={selectedBranchId || null}
          selectedCategory={selectedCategory}
          selectedGroupId={form.values.groupId}
          vendorName={form.values.vendorName ?? ''}
        />
      </AppFormScreen>
      <ExpenseCategorySheet
        onClose={() => setCategorySheetVisible(false)}
        onSelect={(category: ExpenseCategory) => {
          form.setField('category', category);
          setCategorySheetVisible(false);
        }}
        selectedCategory={selectedCategory}
        visible={categorySheetVisible}
      />
      <ExpenseGroupManagerSheet
        archiveGroup={archiveGroup}
        canEdit={canEdit}
        createGroup={createGroup}
        groups={allGroups}
        onClose={() => setGroupManagerVisible(false)}
        renameGroup={renameGroup}
        visible={groupManagerVisible}
      />
    </>
  );
}

export default function AddExpenseScreen() {
  const { colors } = useTheme();
  const { canCreate, canEdit, error, isLoading, isRefreshing } =
    useExpenseAccess();

  if (isLoading) {
    return <ExpenseStatusShell colors={colors} status="loading" />;
  }

  if (!canCreate) {
    if (error) {
      return (
        <ExpenseStatusShell
          colors={colors}
          errorMessage={error.message}
          status="error"
        />
      );
    }

    return (
      <ExpenseStatusShell
        colors={colors}
        errorMessage="You do not have permission to add expenses"
        status="denied"
      />
    );
  }

  return <AddExpenseForm canEdit={canEdit} isRefreshing={isRefreshing} />;
}
