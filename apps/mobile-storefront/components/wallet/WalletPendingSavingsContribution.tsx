import { Pressable, Text, View } from 'react-native';
import { BRAND, type default as Colors, palette } from '@/constants/Colors';

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
        Your money is reserved while PiggyVest processes this transfer. It will
        appear in savings only after confirmation. Check the status instead of
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
          borderColor: BRAND.primary,
          backgroundColor: BRAND.primary,
        }}
      >
        <Text style={{ color: palette.white, textAlign: 'center' }}>
          {isChecking ? 'Checking contribution…' : 'Check contribution status'}
        </Text>
      </Pressable>
    </View>
  );
}
