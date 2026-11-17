import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';

export function WalletPendingSavingsContribution({
  colors,
  isChecking,
  onCheck,
}: {
  colors: (typeof Colors)['light'];
  isChecking: boolean;
  /** A status read for the stored contribution; never a new payment. */
  onCheck?: () => unknown;
}) {
  // The automatic re-checks live with the pending operation in the wallet
  // screen (usePendingSavingsStatusPolling), so they keep going whether or
  // not this card is on screen. This button only asks once more, now.
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: colors.textSecondary }}>
        Your contribution is awaiting confirmation. We'll keep checking; you can
        also check now before starting another payment.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check contribution status"
        accessibilityState={{ disabled: isChecking, busy: isChecking }}
        disabled={isChecking || !onCheck}
        onPress={() => {
          if (isChecking || !onCheck) return;
          // The check reports its own outcome in the wallet notice; only an
          // unexpected failure is logged, so real bugs stay visible.
          void Promise.resolve(onCheck()).catch((error: unknown) => {
            console.warn('[Savings] Status check failed unexpectedly', error);
          });
        }}
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
