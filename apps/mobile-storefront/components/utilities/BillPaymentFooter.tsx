import type { ComponentProps } from 'react';
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
  /** Why Pay is disabled (amount issue or known shortfall), if anything. */
  blockedReason?: string | null;
  colors: typeof Colors.light;
  footerBottomOffset: number;
  insetsBottom: number;
  isBusy: boolean;
  isKeyboardVisible: boolean;
  notice?: ComponentProps<typeof UtilityPayButton>['notice'];
  numericAmount: number;
  onPurchase: () => void;
}

export function BillPaymentFooter({
  blockedReason = null,
  colors,
  footerBottomOffset,
  insetsBottom,
  isBusy,
  isKeyboardVisible,
  notice = null,
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
        blockedReason={blockedReason}
        buttonStyle={styles.payButton}
        isBusy={isBusy}
        label={paymentLabel}
        notice={notice}
        onPress={onPurchase}
        textStyle={styles.payButtonText}
      />
    </View>
  );
}
