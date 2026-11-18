import { useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';

const CHECK_COPY = {
  body: "Your contribution is awaiting confirmation. We'll keep checking for about 5 minutes, and again when you come back to the app. You can tap to check any time before starting another payment.",
  action: 'Check contribution status',
  busy: 'Checking contribution…',
};
// An unfinished older-style contribution has no status read: its button sends
// the very same request again (same amount), which can never charge twice.
const RETRY_COPY = {
  body: "Your last contribution didn't finish. Retry it with the same amount; you won't be charged twice.",
  action: 'Retry contribution',
  busy: 'Retrying contribution…',
};

export function WalletPendingSavingsContribution({
  colors,
  isChecking,
  onCheck,
  retry = false,
}: {
  colors: (typeof Colors)['light'];
  isChecking: boolean;
  /** A status read (or, with retry, the same request again); never a new payment. */
  onCheck?: () => unknown;
  /** The stored contribution is retried, not status-read. */
  retry?: boolean;
}) {
  const copy = retry ? RETRY_COPY : CHECK_COPY;
  // A second tap before the parent re-renders is ignored, so a retry can
  // never start twice.
  const pressing = useRef(false);
  // The automatic re-checks live with the pending operation in the wallet
  // screen (usePendingSavingsStatusPolling), so they keep going whether or
  // not this card is on screen. This button only asks once more, now.
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: colors.textSecondary }}>{copy.body}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.action}
        accessibilityState={{ disabled: isChecking, busy: isChecking }}
        disabled={isChecking || !onCheck}
        onPress={() => {
          if (isChecking || !onCheck || pressing.current) return;
          pressing.current = true;
          // The check reports its own outcome in the wallet notice; only an
          // unexpected failure is logged, so real bugs stay visible.
          // .then() also catches a synchronous throw from onCheck.
          void Promise.resolve()
            .then(onCheck)
            .catch((error: unknown) => {
              console.warn('[Savings] Status check failed unexpectedly', error);
            })
            .finally(() => {
              pressing.current = false;
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
          {isChecking ? copy.busy : copy.action}
        </Text>
      </Pressable>
    </View>
  );
}
