import Ionicons from '@react-native-vector-icons/ionicons';
import { type ReactNode, useContext, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import type Colors from '@/constants/Colors';
import { IdentityConfirmPanel } from '../identity/IdentityConfirmPanel';
import { SavingsSheetContext } from '../SavingsSheetContext';
import { useSavingsSheetLock } from '../SavingsSheetLock';
import { withSavingsBrand } from '../savings-sheet-colors';
import type { WalletPinSheetBinding } from './use-wallet-pin-prompt';
import { useWalletPinSheet } from './use-wallet-pin-sheet';
import { WalletPinContextStrip } from './WalletPinContextStrip';
import { WalletPinDots } from './WalletPinDots';
import { EmbeddedPinStep } from './WalletPinEmbeddedStep';
import { WalletPinPad } from './WalletPinPad';
import { walletPinSheetStyles as styles } from './WalletPinSheet.styles';
import { WalletPinSheetHeader } from './WalletPinSheetHeader';
import { WalletPinWorkingStep } from './WalletPinWorkingStep';
import {
  approvingLine,
  COPY,
  contextLine,
  ENTER_BODY,
  PIN_TOO_SHORT,
  requestKey,
} from './wallet-pin-sheet-copy';

type WalletColors = (typeof Colors)['light'];

type WalletPinSheetProps = WalletPinSheetBinding & { colors: WalletColors };

/**
 * The wallet PIN step. Inside the savings sheet it takes over that same sheet
 * (no second sheet on top); everywhere else it is its own bottom sheet.
 */
export function WalletPinSheet(props: WalletPinSheetProps) {
  const inSavingsSheet = useContext(SavingsSheetContext);
  // The savings sheet's red accent on every site (the dark theme's own
  // primary is amber), including "Confirm it's you" inside this step.
  const colors = withSavingsBrand(props.colors);
  if (inSavingsSheet)
    return props.request ? (
      <WalletPinPanel
        key={requestKey(props.request)}
        {...props}
        colors={colors}
        embedded
      />
    ) : null;
  return (
    <ModalSheet
      visible={props.request !== null}
      animationType="slide"
      backdropStyle={styles.backdrop}
      onRequestClose={props.onCancel}
    >
      <WalletPinPanel
        key={requestKey(props.request)}
        {...props}
        colors={colors}
      />
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
  // Inside the savings sheet the step covers that sheet and sizes it; a
  // waiting step keeps the current height so the sheet moves only once.
  const wrap = (content: ReactNode) =>
    embedded ? (
      <EmbeddedPinStep
        colors={colors}
        holdHeight={sheet.step === 'loading' || sheet.step === 'approving'}
        onParentClose={onCancel}
      >
        <View style={frame}>{content}</View>
      </EmbeddedPinStep>
    ) : (
      <View style={frame}>{content}</View>
    );
  if (sheet.step === 'confirm')
    return wrap(
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
    );
  if (sheet.step === 'loading' || sheet.step === 'approving')
    return wrap(
      <WalletPinWorkingStep
        colors={colors}
        title={copy.title}
        message={
          sheet.step === 'approving' ? approvingLine(request) : copy.body
        }
        embedded={embedded}
        onClose={sheet.step === 'loading' ? onCancel : undefined}
      />
    );
  return wrap(
    <>
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
    </>
  );
}
