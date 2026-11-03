import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import type { WalletPinSheetBinding } from './use-wallet-pin-prompt';
import {
  useWalletPinSheet,
  WALLET_PIN_UNAVAILABLE,
  type WalletPinStep,
} from './use-wallet-pin-sheet';
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
    title: 'Set a wallet PIN',
    body: 'Choose a 4 to 6 digit PIN. You will enter it each time you save into a goal.',
    action: 'Save PIN',
  },
  reset: {
    title: 'Reset your wallet PIN',
    body: 'Choose a new 4 to 6 digit PIN to continue.',
    action: 'Reset PIN',
  },
  enter: {
    title: 'Enter your wallet PIN',
    body: 'Confirm this contribution with your PIN.',
    action: 'Confirm',
  },
};

function PinField(props: {
  colors: WalletColors;
  label: string;
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
}) {
  const { colors } = props;
  return (
    <>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {props.label.toUpperCase()}
      </Text>
      <TextInput
        accessibilityLabel={props.label}
        style={[
          styles.input,
          {
            backgroundColor: colors.muted,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
        value={props.value}
        onChangeText={props.onChange}
        editable={props.editable}
        secureTextEntry
        keyboardType="number-pad"
        maxLength={6}
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="none"
      />
    </>
  );
}

export function WalletPinSheet({
  colors,
  request,
  onProof,
  onCancel,
}: WalletPinSheetBinding & { colors: WalletColors }) {
  const sheet = useWalletPinSheet({ request, onProof });
  const copy = COPY[sheet.step];
  const entering =
    sheet.step === 'set' || sheet.step === 'reset' || sheet.step === 'enter';
  const choosing = sheet.step === 'set' || sheet.step === 'reset';
  return (
    <Modal
      visible={request !== null}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
          >
            {copy.title}
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {sheet.notice ?? copy.body}
          </Text>
          {sheet.step === 'loading' ? (
            <ActivityIndicator color={colors.primary} />
          ) : null}
          {entering ? (
            <PinField
              colors={colors}
              label={choosing ? 'New PIN' : 'PIN'}
              value={sheet.pin}
              editable={!sheet.busy}
              onChange={sheet.setPin}
            />
          ) : null}
          {choosing ? (
            <PinField
              colors={colors}
              label="Confirm PIN"
              value={sheet.confirmPin}
              editable={!sheet.busy}
              onChange={sheet.setConfirmPin}
            />
          ) : null}
          {sheet.error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: colors.error }]}
            >
              {sheet.error}
            </Text>
          ) : null}
          {entering ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.action}
              accessibilityState={{ disabled: sheet.busy }}
              disabled={sheet.busy}
              onPress={sheet.submit}
              style={[styles.primary, { backgroundColor: colors.primary }]}
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
                    { color: colors.primaryForeground },
                  ]}
                >
                  {copy.action}
                </Text>
              )}
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={entering ? 'Cancel' : 'Close'}
            onPress={onCancel}
            style={styles.secondary}
          >
            <Text
              style={[styles.secondaryText, { color: colors.textSecondary }]}
            >
              {entering ? 'Cancel' : 'Close'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
