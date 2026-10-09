import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';

export function PrimaryWalletCardPendingView({
  colors,
  statusError,
  message,
  operationReference,
  terminalDirective,
  onCheck,
  onBack,
}: {
  colors: typeof Colors.light;
  statusError: boolean;
  message: string | null;
  operationReference?: string;
  terminalDirective?: string | null;
  onCheck: () => void;
  onBack: () => void;
}) {
  return (
    <View style={{ padding: 24, gap: 20 }}>
      <Text accessibilityRole="header" style={{ color: colors.text }}>
        {statusError
          ? 'Could not check funding status'
          : 'Wallet funding pending'}
      </Text>
      <Text accessibilityRole="alert" style={{ color: colors.text }}>
        {statusError
          ? (terminalDirective ??
            'Could not check your funding status. This does not mean your card charge failed. Your operation is saved. Do not pay again; check its status later.')
          : (message ??
            'We are waiting for funding confirmation. Money appears in your wallet once confirmed. Your operation is saved. Do not pay again.')}
      </Text>
      {statusError && message ? (
        <Text style={{ color: colors.textSecondary }}>{message}</Text>
      ) : null}
      {operationReference ? (
        <Text
          accessibilityLabel={`Funding operation reference ${operationReference}`}
          selectable
          style={{ color: colors.textSecondary }}
        >
          Reference: {operationReference}
        </Text>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onCheck}>
        <Text style={{ color: colors.primary }}>Check funding status</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onBack}>
        <Text style={{ color: colors.primary }}>Return to wallet</Text>
      </Pressable>
    </View>
  );
}
