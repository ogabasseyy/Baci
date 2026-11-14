import { View } from 'react-native';
import type Colors from '@/constants/Colors';
import { SPACING } from '@/constants/Colors';
import { dataFormStyles } from './data-form.styles';
import { UtilityPayButton } from './UtilityPayButton';

interface DataFormFooterProps {
  bottomInset: number;
  bottomOffset: number;
  colors: typeof Colors.light;
  isKeyboardVisible: boolean;
  isSubmitting: boolean;
  planAmount: number;
  onPress: () => void;
}

export function DataFormFooter({
  bottomInset,
  bottomOffset,
  colors,
  isKeyboardVisible,
  isSubmitting,
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
        buttonStyle={dataFormStyles.payButton}
        isBusy={isSubmitting}
        label={`Pay ₦${planAmount ? planAmount.toLocaleString() : '0'}`}
        onPress={onPress}
        textStyle={dataFormStyles.payButtonText}
      />
    </View>
  );
}
