import { Text } from 'react-native';
import { styles } from '@/components/transactions/transactions.styles';
import type { ThemeColors } from '@/constants/theme';

interface TransactionOrderDiscountBadgeProps {
  colors: ThemeColors;
  discountAmount?: number;
  formatCurrency: (amount: number) => string;
}

export function TransactionOrderDiscountBadge({
  colors,
  discountAmount = 0,
  formatCurrency,
}: TransactionOrderDiscountBadgeProps) {
  if (discountAmount <= 0) {
    return null;
  }

  return (
    <Text
      style={[
        styles.orderDetailText,
        {
          backgroundColor: colors.errorLight,
          color: colors.error,
        },
      ]}
    >
      Discount -{formatCurrency(discountAmount)}
    </Text>
  );
}
