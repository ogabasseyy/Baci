import { View } from 'react-native';
import { billFormStyles as styles } from '@/components/utilities/bill-form-styles';
import type Colors from '@/constants/Colors';
import { SPACING } from '@/constants/Colors';
import { UtilityPayButton } from './UtilityPayButton';

const BILL_PAYMENT_AMOUNT_FORMATTER = new Intl.NumberFormat('en-NG', {
  currency: 'NGN',
  currencyDisplay: 'narrowSymbol',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  style: 'currency',
});

interface BillPaymentFooterProps {
  colors: typeof Colors.light;
  footerBottomOffset: number;
  insetsBottom: number;
  isBusy: boolean;
  isKeyboardVisible: boolean;
  numericAmount: number;
  onPurchase: () => void;
}

export function BillPaymentFooter({
  colors,
  footerBottomOffset,
  insetsBottom,
  isBusy,
  isKeyboardVisible,
  numericAmount,
  onPurchase,
}: BillPaymentFooterProps) {
  const paymentLabel = `Pay ${BILL_PAYMENT_AMOUNT_FORMATTER.format(numericAmount)}`;

  return (
    <View
      style={[
        styles.footer,
        {
          borderTopColor: colors.border,
          backgroundColor: colors.muted,
          bottom: footerBottomOffset,
          paddingBottom: isKeyboardVisible
            ? SPACING.sm
            : Math.max(insetsBottom, SPACING.md),
        },
      ]}
    >
      <UtilityPayButton
        amount={numericAmount}
        buttonStyle={styles.payButton}
        isBusy={isBusy}
        label={paymentLabel}
        onPress={onPurchase}
        textStyle={styles.payButtonText}
      />
    </View>
  );
}
