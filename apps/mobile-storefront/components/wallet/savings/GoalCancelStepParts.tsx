import { Pressable, Text } from 'react-native';
import type Colors from '@/constants/Colors';
import { styles } from './goal-cancel-step.styles';

type WalletColors = (typeof Colors)['light'];

export function GoalCancelButton({
  colors,
  label,
  onPress,
  primary = false,
}: {
  colors: WalletColors;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.button, primary && { backgroundColor: colors.primary }]}
    >
      <Text
        style={[
          styles.buttonText,
          { color: primary ? colors.primaryForeground : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
