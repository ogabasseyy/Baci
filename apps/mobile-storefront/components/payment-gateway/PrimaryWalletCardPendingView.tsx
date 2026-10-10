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
  // A set directive fully replaces the retained-operation guard, so it
  // must only ever carry server-terminal outcomes (abandoned) or
  // ambiguity-aware redirects (dropped → re-adoption, account-changed
  // → go back). Ambiguous server states (reconciliation_required,
  // custody_pending) must leave this unset so the do-not-pay-again
  // guard below stays visible; the completion tests pin that.
  terminalDirective?: string | null;
  // Omitted when no status check could succeed (e.g. the signed-in
  // account is not the checkout owner): the view then offers only the
  // way back instead of a doomed retry.
  onCheck?: () => void;
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
      {operationReference ? (
        <Text
          accessibilityLabel={`Funding operation reference ${operationReference}`}
          selectable
          style={{ color: colors.textSecondary }}
        >
          Reference: {operationReference}
        </Text>
      ) : null}
      {onCheck ? (
        <Pressable accessibilityRole="button" onPress={onCheck}>
          <Text style={{ color: colors.primary }}>Check funding status</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onBack}>
        <Text style={{ color: colors.primary }}>Return to wallet</Text>
      </Pressable>
    </View>
  );
}
