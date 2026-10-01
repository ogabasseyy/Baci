import { ExpenseListContent } from '@/components/expenses/ExpenseListContent';
import { ExpenseStatusShell } from '@/components/expenses/ExpenseStatusShell';
import { ScreenSkeleton } from '@/components/ui/ScreenSkeleton';
import { useExpenseAccess } from '@/hooks/useExpenseAccess';
import { useTheme } from '@/hooks/useTheme';

export default function ExpensesScreen() {
  const { canCreate, canEdit, canView, error, isLoading } = useExpenseAccess();
  const { colors } = useTheme();

  if (isLoading) {
    return <ScreenSkeleton variant="list" cards={4} />;
  }

  if (error && !canView) {
    return (
      <ExpenseStatusShell
        colors={colors}
        errorMessage="Could not verify expense access. Please try again."
        status="error"
      />
    );
  }

  if (!canView) {
    return <ExpenseStatusShell colors={colors} status="denied" />;
  }

  return <ExpenseListContent canCreate={canCreate} canEdit={canEdit} />;
}
