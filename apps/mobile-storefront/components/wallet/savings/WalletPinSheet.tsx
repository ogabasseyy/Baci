import Ionicons from '@react-native-vector-icons/ionicons';
import { useContext, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import type Colors from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { IdentityConfirmPanel } from '../identity/IdentityConfirmPanel';
import { SavingsSheetContext } from '../SavingsSheetContext';
import { useSavingsSheetLock } from '../SavingsSheetLock';
import type { WalletPinSheetBinding } from './use-wallet-pin-prompt';
import {
  useWalletPinSheet,
  WALLET_PIN_UNAVAILABLE,
  type WalletPinStep,
} from './use-wallet-pin-sheet';
import { WalletPinContextStrip } from './WalletPinContextStrip';
import { WalletPinDots } from './WalletPinDots';
import { EmbeddedPinStep } from './WalletPinEmbeddedStep';
import { WalletPinPad } from './WalletPinPad';
import { walletPinSheetStyles as styles } from './WalletPinSheet.styles';
import { WalletPinSheetHeader } from './WalletPinSheetHeader';

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
  // Drawn by IdentityConfirmPanel; listed so every step has copy.
  confirm: { title: "Confirm it's you", body: '', action: '' },
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
  const goal = request.goalTitle?.trim() || 'this goal';
  return request.action === 'cancel'
    ? `Cancelling ${goal}`
    : `Completing ${goal}`;
}

/**
 * A new key per request (and on close) remounts the panel, so the two-step
 * choose/confirm state never carries over to the next request.
 */
function requestKey(request: WalletPinSheetBinding['request']) {
  if (!request) return 'closed';
  const amount = 'amountKobo' in request ? request.amountKobo : '';
  return [
    request.operationId,
    request.goalId,
    request.merchantId ?? '',
    request.action ?? 'fund',
    amount,
  ].join('|');
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
      <EmbeddedPinStep colors={props.colors} onParentClose={props.onCancel}>
        <WalletPinPanel key={requestKey(props.request)} {...props} embedded />
      </EmbeddedPinStep>
    ) : null;
  return (
    <ModalSheet
      visible={props.request !== null}
      animationType="slide"
      backdropStyle={styles.backdrop}
      onRequestClose={props.onCancel}
    >
      <WalletPinPanel key={requestKey(props.request)} {...props} />
    </ModalSheet>
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
  // A PIN check in flight keeps the savings sheet from being dragged closed.
  useSavingsSheetLock(embedded && sheet.busy);
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
    // A short confirmation is not a mismatch: keep the first PIN and let the
    // customer finish typing instead of starting over.
    if (choosing && sheet.confirmPin.length < 4) return setTooShort(true);
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
  const frame = [
    styles.sheet,
    embedded && styles.embedded,
    { backgroundColor: colors.background },
  ];
  if (sheet.step === 'confirm')
    return (
      <View style={frame}>
        <IdentityConfirmPanel
          colors={colors}
          expectedUserId={expectedUserId}
          onConfirmed={() => {
            setConfirming(false);
            void sheet.identityConfirmed();
          }}
          onCancel={onCancel}
          embedded={embedded}
          context={context}
        />
      </View>
    );
  return (
    <View style={frame}>
      <WalletPinSheetHeader
        colors={colors}
        title={copy.title}
        closeLabel={close}
        embedded={embedded}
        onClose={onCancel}
      />
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
        <WalletPinContextStrip colors={colors} text={context} />
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
