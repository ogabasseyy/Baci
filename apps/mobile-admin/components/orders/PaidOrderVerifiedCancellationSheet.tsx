import type { ReactNode } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { AppSheetModal } from '@/components/ui/AppSheetModal';
import type { ThemeColors } from '@/constants/theme';
import type { VerifiedSettlementAction } from '@/lib/paid-order-amendment-api';

interface Props {
  colors: ThemeColors;
  closing: boolean;
  reason: string;
  setReason: (reason: string) => void;
  busy: boolean;
  recoveryRequired: boolean;
  pendingReady: boolean;
  canOpenVerifiedCancellation: boolean;
  verifiedCancellationReady: boolean;
  savedAction: VerifiedSettlementAction | null;
  message: string;
  onConfirm: () => void;
  onReload: () => void;
  onClose: () => void;
  retrySavedAction: (payload: VerifiedSettlementAction) => ReactNode;
}

export function PaidOrderVerifiedCancellationSheet({
  colors,
  closing,
  reason,
  setReason,
  busy,
  recoveryRequired,
  pendingReady,
  canOpenVerifiedCancellation,
  verifiedCancellationReady,
  savedAction,
  message,
  onConfirm,
  onReload,
  onClose,
  retrySavedAction,
}: Props) {
  function action(label: string, onPress: () => void, disabled = false) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || busy }}
        disabled={disabled || busy}
        onPress={onPress}
        style={{
          minHeight: 44,
          justifyContent: 'center',
          paddingHorizontal: 12,
        }}
      >
        <Text
          style={{
            color: disabled || busy ? colors.textMuted : colors.primary,
          }}
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <AppSheetModal
      visible
      accessibilityLabel="Verified cancellation"
      onClose={onClose}
    >
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 20 }}>
        {closing
          ? 'Cancel with verified refunds'
          : 'Hold fulfillment for cancellation'}
      </Text>
      <Text style={{ color: colors.text, marginVertical: 12 }}>
        {closing
          ? 'This marks the order cancelled, posts the verified refunds, and returns stock to inventory.'
          : 'Finance will verify Credit Direct and any separate top-up before the order is cancelled.'}
      </Text>
      <TextInput
        accessibilityLabel="Cancellation reason"
        placeholder="Cancellation reason"
        placeholderTextColor={colors.textMuted}
        value={reason}
        onChangeText={setReason}
        editable={!busy}
        maxLength={500}
        style={{
          color: colors.text,
          borderColor: colors.border,
          borderWidth: 1,
          padding: 12,
        }}
      />
      {savedAction
        ? retrySavedAction(savedAction)
        : action(
            'Confirm',
            onConfirm,
            !reason.trim() ||
              recoveryRequired ||
              !pendingReady ||
              (closing
                ? !verifiedCancellationReady
                : !canOpenVerifiedCancellation)
          )}
      {recoveryRequired && action('Reload order status', onReload, busy)}
      {message && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
          {message}
        </Text>
      )}
      {action('Close', onClose)}
    </AppSheetModal>
  );
}
