import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { WalletPinContextStrip } from '../savings/WalletPinContextStrip';
import { WalletPinDots } from '../savings/WalletPinDots';
import { WalletPinPad } from '../savings/WalletPinPad';
import { walletPinSheetStyles as styles } from '../savings/WalletPinSheet.styles';
import { WalletPinSheetHeader } from '../savings/WalletPinSheetHeader';
import {
  IDENTITY_CODE_LENGTH,
  useIdentityConfirmation,
} from './use-identity-confirmation';

type WalletColors = (typeof Colors)['light'];

const IDENTITY_TITLE = "Confirm it's you";

/**
 * "For your security, confirm it's you": shown before a new or reset wallet
 * PIN when the sign-in is too old. Emails a 6-digit code, checks it with the
 * in-sheet number pad, then hands straight back (onConfirmed) without
 * signing out.
 */
export function IdentityConfirmPanel({
  colors,
  expectedUserId,
  onConfirmed,
  onCancel,
  embedded = false,
  context = null,
}: {
  colors: WalletColors;
  expectedUserId?: string;
  onConfirmed: () => void;
  onCancel?: () => void;
  embedded?: boolean;
  context?: string | null;
}) {
  const confirm = useIdentityConfirmation({ expectedUserId, onConfirmed });
  const where = confirm.maskedEmail ?? 'your email';
  const body = confirm.sent
    ? `Enter the ${IDENTITY_CODE_LENGTH}-digit code we sent to ${where}.`
    : `To keep your wallet safe, we'll email a ${IDENTITY_CODE_LENGTH}-digit code to ${where}.`;
  const action = confirm.sent ? 'Confirm' : 'Send code';
  // "Send code" is always ready; "Confirm" stays grey until the code is in.
  const ready = !confirm.sent || confirm.ready;
  return (
    <>
      <WalletPinSheetHeader
        colors={colors}
        title={IDENTITY_TITLE}
        closeLabel="Cancel"
        embedded={embedded}
        onClose={onCancel}
      />
      <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>
      {context ? (
        <WalletPinContextStrip colors={colors} text={context} />
      ) : null}
      {confirm.sent ? (
        <WalletPinDots
          colors={colors}
          label="Code"
          length={confirm.code.length}
          fixedSlots={IDENTITY_CODE_LENGTH}
        />
      ) : null}
      {confirm.error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.error }]}
        >
          {confirm.error}
        </Text>
      ) : null}
      {confirm.notice && !confirm.error ? (
        <Text style={[styles.notice, { color: colors.textSecondary }]}>
          {confirm.notice}
        </Text>
      ) : null}
      {confirm.sent ? (
        <WalletPinPad
          colors={colors}
          disabled={confirm.busy}
          onChange={confirm.setCode}
          value={confirm.code}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action}
        accessibilityState={{ disabled: confirm.busy || !ready }}
        disabled={confirm.busy || !ready}
        onPress={confirm.sent ? confirm.verify : confirm.send}
        style={[
          styles.primary,
          { backgroundColor: ready ? colors.primary : colors.muted },
        ]}
      >
        {confirm.busy ? (
          <ActivityIndicator color={colors.primaryForeground} size="small" />
        ) : (
          <Text
            style={[
              styles.primaryText,
              {
                color: ready ? colors.primaryForeground : colors.textSecondary,
              },
            ]}
          >
            {action}
          </Text>
        )}
      </Pressable>
      {confirm.sent ? (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send a new code"
            accessibilityState={{
              disabled: confirm.busy || !confirm.canResend,
            }}
            disabled={confirm.busy || !confirm.canResend}
            onPress={confirm.send}
            style={styles.secondary}
          >
            <Text style={[styles.secondaryText, { color: colors.primary }]}>
              Send a new code
            </Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}
