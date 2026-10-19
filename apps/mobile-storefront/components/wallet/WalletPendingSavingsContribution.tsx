import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';

export function WalletPendingSavingsContribution({
  colors,
  isChecking,
  onCheck,
}: {
  colors: (typeof Colors)['light'];
  isChecking: boolean;
  onCheck: () => void;
}) {
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: colors.textSecondary }}>
        Your contribution is awaiting confirmation. Check its status before
        starting another payment.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check contribution status"
        accessibilityState={{ disabled: isChecking, busy: isChecking }}
        disabled={isChecking}
        onPress={onCheck}
        style={{
          padding: 16,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.primary,
        }}
      >
        <Text style={{ color: colors.primary, textAlign: 'center' }}>
          {isChecking ? 'Checking contribution…' : 'Check contribution status'}
        </Text>
      </Pressable>
    </View>
  );
}
