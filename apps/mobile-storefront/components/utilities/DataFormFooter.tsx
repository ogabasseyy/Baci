import type { ComponentProps } from 'react';
import { View } from 'react-native';
import type Colors from '@/constants/Colors';
import { SPACING } from '@/constants/Colors';
import { dataFormStyles } from './data-form.styles';
import { UtilityPayButton } from './UtilityPayButton';

interface DataFormFooterProps {
  /** Why Pay is disabled (form issue or known shortfall), if anything. */
  blockedReason?: string | null;
  bottomInset: number;
  bottomOffset: number;
  colors: typeof Colors.light;
  isKeyboardVisible: boolean;
  isSubmitting: boolean;
  notice?: ComponentProps<typeof UtilityPayButton>['notice'];
  planAmount: number;
  onPress: () => void;
}

export function DataFormFooter({
  blockedReason = null,
  bottomInset,
  bottomOffset,
  colors,
  isKeyboardVisible,
  isSubmitting,
  notice = null,
  onPress,
  planAmount,
}: DataFormFooterProps) {
  return (
    <View
      style={[
        dataFormStyles.footer,
        {
          borderTopColor: colors.border,
          backgroundColor: colors.muted,
          bottom: bottomOffset,
          paddingBottom: isKeyboardVisible
            ? SPACING.sm
            : Math.max(bottomInset, SPACING.md),
        },
      ]}
    >
      <UtilityPayButton
        amount={planAmount}
        blockedReason={blockedReason}
        buttonStyle={dataFormStyles.payButton}
        isBusy={isSubmitting}
        label={`Pay ₦${planAmount ? planAmount.toLocaleString() : '0'}`}
        notice={notice}
        onPress={onPress}
        textStyle={dataFormStyles.payButtonText}
      />
    </View>
  );
}
