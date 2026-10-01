import type { IoniconsIconName } from '@react-native-vector-icons/ionicons';

export interface ExpenseMenuItem {
  id: 'expenses';
  icon: IoniconsIconName;
  label: 'Expenses';
  description: 'Track spending and receipts';
  onPress: () => void;
}

export function createExpenseMenuItem(
  canViewExpenses: boolean,
  onPress: () => void,
  canCreateExpenses = false,
  onCreatePress = onPress
): ExpenseMenuItem | null {
  if (!canViewExpenses && !canCreateExpenses) return null;

  return {
    id: 'expenses',
    icon: 'wallet-outline',
    label: 'Expenses',
    description: 'Track spending and receipts',
    onPress: canViewExpenses ? onPress : onCreatePress,
  };
}
