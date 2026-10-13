import type { StyleProp, ViewStyle } from 'react-native';
import type { ExpenseDetail } from '@/schemas/expense';

export type { ExpenseDetail };

export interface ExpenseDetailColors {
  background: string;
  border: string;
  card: string;
  primary: string;
  text: string;
  textSecondary: string;
}

export interface ExpenseStatusShellProps {
  status: 'loading' | 'error' | 'not-found' | 'denied';
  colors: ExpenseDetailColors;
  errorMessage?: string;
  onRetry?: () => void;
}

export interface ExpenseDetailsProps {
  expense: ExpenseDetail;
  branchName: string;
  colors: ExpenseDetailColors;
  formattedAmount: string;
  groupName: string;
  receiptUrl: string | null;
  receiptLoading?: boolean;
  receiptError?: Error | null;
  cardShadow?: StyleProp<ViewStyle>;
}
