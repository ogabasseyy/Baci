import { useBottomSheet } from '@gorhom/bottom-sheet';
import Ionicons from '@react-native-vector-icons/ionicons';
import { type ReactNode, useContext, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import type Colors from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { SavingsSheetContext } from '../SavingsSheetContext';
import type { WalletPinSheetBinding } from './use-wallet-pin-prompt';
import {
  useWalletPinSheet,
  WALLET_PIN_UNAVAILABLE,
  type WalletPinStep,
} from './use-wallet-pin-sheet';
import { WalletPinDots, WalletPinPad } from './WalletPinPad';
import { walletPinSheetStyles as styles } from './WalletPinSheet.styles';

type WalletColors = (typeof Colors)['light'];

const COPY: Record<
  WalletPinStep,
  { title: string; body: string; action: string }
> = {
  loading: { title: 'Wallet PIN', body: 'Checking your PIN...', action: '' },
  unavailable: {
    title: 'Wallet PIN',
    body: WALLET_PIN_UNAVAILABLE,
    action: '',
  },
  set: {
    title: 'Create your wallet PIN',
    body: "You'll use it every time you save.",
    action: 'Save PIN',
  },
  reset: {
    title: 'Reset your wallet PIN',
    body: 'Choose a new PIN to continue.',
    action: 'Reset PIN',
  },
  enter: {
    title: 'Enter your wallet PIN',
    body: 'Confirm this contribution with your PIN.',
    action: 'Confirm',
  },
};

const ENTER_BODY = {
  cancel: 'Enter your PIN to cancel this goal.',
  complete: 'Enter your PIN to complete this goal.',
} as const;

const PIN_TOO_SHORT = 'Enter 4 to 6 digits.';

/** What the PIN is for, in a short strip under the title. */
function contextLine(request: WalletPinSheetBinding['request']) {
  if (!request) return null;
  if ('amountKobo' in request)
    return `Adding ${formatNgnCurrency(request.amountKobo / 100)} to savings`;
  return request.action === 'cancel'
    ? 'Cancelling this goal'
    : 'Completing this goal';
}

type WalletPinSheetProps = WalletPinSheetBinding & { colors: WalletColors };

/**
 * The wallet PIN step. Inside the savings sheet it takes over that same sheet
 * (no second sheet on top); everywhere else it is its own bottom sheet.
 */
export function WalletPinSheet(props: WalletPinSheetProps) {
  const inSavingsSheet = useContext(SavingsSheetContext);
  if (inSavingsSheet)
    return props.request ? (
      <EmbeddedPinStep colors={props.colors}>
        <WalletPinPanel {...props} embedded />
      </EmbeddedPinStep>
    ) : null;
  return (
    <ModalSheet
      visible={props.request !== null}
      animationType="slide"
      backdropStyle={styles.backdrop}
      onRequestClose={props.onCancel}
    >
      <WalletPinPanel {...props} />
    </ModalSheet>
  );
}

/** The sheet's handle, top padding and bottom safe area around the step. */
const SHEET_CHROME_HEIGHT = 72;

/**
 * Covers the savings sheet's content and resizes that sheet to fit the PIN
 * step exactly (no empty space below), then back when the step closes.
 */
function EmbeddedPinStep({
  children,
  colors,
}: {
  children: ReactNode;
  colors: WalletColors;
}) {
  const { snapToIndex, snapToPosition } = useBottomSheet();
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (height > 0) snapToPosition(height + SHEET_CHROME_HEIGHT);
  }, [height, snapToPosition]);
  useEffect(() => () => snapToIndex(0), [snapToIndex]);
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
    >
      <View
        testID="pin-step-content"
        onLayout={(event) =>
          setHeight(Math.ceil(event.nativeEvent.layout.height))
        }
      >
        {children}
      </View>
    </View>
  );
}

function WalletPinPanel({
  colors,
  embedded = false,
  request,
  expectedUserId,
  onProof,
  onCancel,
  onInvalid,
}: WalletPinSheetProps & { embedded?: boolean }) {
  const sheet = useWalletPinSheet({
    request,
    expectedUserId,
    onProof,
    onInvalid,
  });
  // Choosing a PIN is two steps: type it, then type it again to confirm.
  const [confirming, setConfirming] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  const baseCopy = COPY[sheet.step];
  const copy =
    sheet.step === 'enter' && request?.action && request.action !== 'fund'
      ? { ...baseCopy, body: ENTER_BODY[request.action] }
      : baseCopy;
  const entering =
    sheet.step === 'set' || sheet.step === 'reset' || sheet.step === 'enter';
  const choosing = sheet.step === 'set' || sheet.step === 'reset';
  const onConfirmStep = choosing && confirming;
  const value = onConfirmStep ? sheet.confirmPin : sheet.pin;
  const setValue = (next: string) => {
    setTooShort(false);
    if (onConfirmStep) sheet.setConfirmPin(next);
    else sheet.setPin(next);
  };
  const action = choosing && !confirming ? 'Continue' : copy.action;
  // Grey until a full PIN is in, then red: it shows when tapping will work.
  const ready = value.length >= 4;
  const onAction = async () => {
    if (choosing && !confirming) {
      if (sheet.pin.length < 4) return setTooShort(true);
      return setConfirming(true);
    }
    await sheet.submit();
    if (choosing) {
      // Saved, refused or mismatched: start the two steps again if needed.
      setConfirming(false);
      sheet.setPin('');
      sheet.setConfirmPin('');
    }
  };
  const close = entering ? 'Cancel' : 'Close';
  const context = contextLine(request);
  const error = tooShort ? PIN_TOO_SHORT : sheet.error;
  return (
    <View
      style={[
        styles.sheet,
        embedded && styles.embedded,
        { backgroundColor: colors.background },
      ]}
    >
      <View style={styles.header}>
        <View
          style={[styles.icon, { backgroundColor: colors.primaryLowOpacity }]}
        >
          <Ionicons
            name="lock-closed-outline"
            size={16}
            color={colors.primary}
          />
        </View>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.primary }]}
        >
          {copy.title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={close}
          hitSlop={8}
          onPress={onCancel}
          style={styles.close}
        >
          <Ionicons
            name={embedded ? 'arrow-back' : 'close'}
            size={20}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {sheet.notice
          ? request?.action && request.action !== 'fund'
            ? `${sheet.notice} ${copy.body}`
            : sheet.notice
          : choosing
            ? confirming
              ? 'Enter it again to confirm.'
              : 'Choose 4 to 6 digits.'
            : copy.body}
      </Text>
      {context && entering ? (
        <View style={[styles.context, { backgroundColor: colors.muted }]}>
          <Ionicons name="wallet-outline" size={16} color={colors.primary} />
          <Text style={[styles.contextText, { color: colors.text }]}>
            {context}
          </Text>
        </View>
      ) : null}
      {sheet.step === 'loading' ? (
        <ActivityIndicator color={colors.primary} />
      ) : null}
      {entering ? (
        <WalletPinDots
          colors={colors}
          label={choosing ? (confirming ? 'Confirm PIN' : 'New PIN') : 'PIN'}
          length={value.length}
        />
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.error }]}
        >
          {error}
        </Text>
      ) : null}
      {entering ? (
        <>
          <WalletPinPad
            colors={colors}
            disabled={sheet.busy}
            onChange={setValue}
            value={value}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action}
            accessibilityState={{ disabled: sheet.busy }}
            disabled={sheet.busy}
            onPress={onAction}
            style={[
              styles.primary,
              { backgroundColor: ready ? colors.primary : colors.muted },
            ]}
          >
            {sheet.busy ? (
              <ActivityIndicator
                color={colors.primaryForeground}
                size="small"
              />
            ) : (
              <Text
                style={[
                  styles.primaryText,
                  {
                    color: ready
                      ? colors.primaryForeground
                      : colors.textSecondary,
                  },
                ]}
              >
                {action}
              </Text>
            )}
          </Pressable>
          <View style={styles.footer}>
            <Ionicons
              name="shield-checkmark-outline"
              size={14}
              color={colors.textSecondary}
            />
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>
              Never share your PIN with anyone.
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );
}
