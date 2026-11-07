import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import type Colors from '@/constants/Colors';
import { walletSavingsProgressModalStyles as styles } from './wallet-savings-progress-modal.styles';

type WalletSavingsContributionButtonProps = {
  colors: (typeof Colors)['light'];
  disabled: boolean;
  isAdding: boolean;
  onPress: () => void;
};

export function WalletSavingsContributionButton({
  colors,
  disabled,
  isAdding,
  onPress,
}: WalletSavingsContributionButtonProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Confirm savings top-up"
      accessibilityState={{ busy: isAdding, disabled: disabled || isAdding }}
      disabled={disabled || isAdding}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={[
        styles.primaryButton,
        { backgroundColor: colors.primary },
        isFocused && styles.primaryButtonFocused,
        (disabled || isAdding) && styles.disabledButton,
      ]}
    >
      <Text
        style={[styles.primaryButtonText, { color: colors.primaryForeground }]}
      >
        {isAdding ? 'Adding...' : 'Add to savings'}
      </Text>
    </Pressable>
  );
}
