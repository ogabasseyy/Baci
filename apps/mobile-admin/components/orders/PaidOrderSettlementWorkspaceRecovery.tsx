import { Pressable, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';

interface Props {
  colors: ThemeColors;
  busy: boolean;
  pendingReadError: boolean;
  unreadableMessage: boolean;
  recoveryRequired: boolean;
  workspaceFresh: boolean;
  showGeneralReload: boolean;
  verifiedCancellationPending: boolean;
  verifiedCancellationReady: boolean;
  onRetryPending: () => void;
  onReload: () => void;
}

export function PaidOrderSettlementWorkspaceRecovery({
  colors,
  busy,
  pendingReadError,
  unreadableMessage,
  recoveryRequired,
  workspaceFresh,
  showGeneralReload,
  verifiedCancellationPending,
  verifiedCancellationReady,
  onRetryPending,
  onReload,
}: Props) {
  return (
    <View>
      {verifiedCancellationPending && (
        <Text style={{ color: colors.text, paddingHorizontal: 12 }}>
          {verifiedCancellationReady
            ? 'Refund evidence complete.'
            : 'Fulfillment is on hold while Finance verifies each refund.'}
        </Text>
      )}
      {pendingReadError && (
        <>
          <Text style={{ color: colors.text }}>
            Unable to read the saved settlement request. Retry before
            continuing.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={onRetryPending}
          >
            <Text style={{ color: busy ? colors.textMuted : colors.primary }}>
              Retry saved settlement check
            </Text>
          </Pressable>
        </>
      )}
      {unreadableMessage && (
        <Text style={{ color: colors.text }}>
          A saved settlement request could not be read. Reload the order status
          before starting another settlement action.
        </Text>
      )}
      {showGeneralReload && (recoveryRequired || !workspaceFresh) && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onReload}
          style={{
            minHeight: 44,
            justifyContent: 'center',
            paddingHorizontal: 12,
          }}
        >
          <Text style={{ color: busy ? colors.textMuted : colors.primary }}>
            Reload order status
          </Text>
        </Pressable>
      )}
    </View>
  );
}
