import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, SPACING } from '@/constants/Colors';
import { dataFormStyles } from './data-form.styles';

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
      <Pressable
        style={[
          dataFormStyles.payButton,
          {
            backgroundColor: BRAND.primary,
            opacity: isSubmitting ? 0.7 : 1,
          },
        ]}
        onPress={onPress}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={dataFormStyles.payButtonText}>
            {`Pay ₦${planAmount ? planAmount.toLocaleString() : '0'}`}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
