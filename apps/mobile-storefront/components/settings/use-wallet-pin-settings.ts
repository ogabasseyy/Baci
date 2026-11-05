import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { submitWalletPin } from '@/lib/wallet-pin-api';
import { changeWalletPin } from '@/lib/wallet-pin-change-api';
import { WalletPinSchemas } from '@/schemas/wallet-pin';
import { useAuthStore } from '@/stores/auth-store';
import {
  useWalletPinSettingsGate,
  type WalletPinStatus,
} from './use-wallet-pin-settings-gate';

export type WalletPinMode = 'set' | 'change' | 'reset';

const FORMAT_ERROR = 'Enter 4 to 6 digits.';
const MISMATCH_ERROR = 'The two PINs do not match.';
const SAME_PIN_ERROR = 'Choose a different PIN from your current one.';
const FALLBACK_ERROR = 'Something went wrong. Please try again.';
const SUCCESS: Record<WalletPinMode, string> = {
  set: 'Your wallet PIN has been saved.',
  change: 'Your wallet PIN has been changed.',
  reset: 'Your wallet PIN has been reset.',
};

const isPin = (value: string) => WalletPinSchemas.pin.safeParse(value).success;

function codeOf(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function messageOf(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : FALLBACK_ERROR;
}

function modeFromStatus(status: WalletPinStatus | null): WalletPinMode {
  if (status?.resetRequired) return 'reset';
  return status?.hasPin ? 'change' : 'set';
}

function validate(
  mode: WalletPinMode,
  current: string,
  next: string,
  confirm: string
) {
  if (mode === 'change' && !isPin(current)) return FORMAT_ERROR;
  if (!isPin(next)) return FORMAT_ERROR;
  if (next !== confirm) return MISMATCH_ERROR;
  if (mode === 'change' && next === current) return SAME_PIN_ERROR;
  return null;
}

/**
 * State for Settings > Wallet PIN. The server decides which form shows. The
 * PINs live only in this state and the request body: all fields are cleared
 * after every submit, on blur and on unmount, and nothing is logged or stored.
 * A request is never retried automatically.
 */
export function useWalletPinSettings() {
  const gate = useWalletPinSettingsGate();
  const navigation = useNavigation();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const signOut = useAuthStore((s) => s.signOut);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  // A mode picked by the user or by an outcome only holds for the status it
  // was chosen against; a fresh status read decides again.
  const [override, setOverride] = useState<{
    mode: WalletPinMode;
    status: WalletPinStatus | null;
  } | null>(null);
  const inFlight = useRef(false);

  const mode =
    override && override.status === gate.status
      ? override.mode
      : modeFromStatus(gate.status);

  useEffect(
    () =>
      navigation.addListener('blur', () => {
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
      }),
    [navigation]
  );

  const clearFields = () => {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
  };

  const switchMode = (next: WalletPinMode) => {
    clearFields();
    setError(null);
    setOverride({ mode: next, status: gate.status });
  };

  const onSuccess = () => {
    setNotice(SUCCESS[mode]);
    setOverride({ mode: 'change', status: gate.status });
    // Refresh only after the user has seen the notice: a failed refresh can
    // turn the gate off and redirect away from this screen.
    Alert.alert(
      SUCCESS[mode],
      undefined,
      [{ text: 'OK', onPress: gate.refresh }],
      {
        cancelable: false,
      }
    );
  };

  const onFailure = (failure: unknown) => {
    const code = codeOf(failure);
    if (code === 'PIN_ALREADY_SET') {
      switchMode('change');
      gate.refresh();
    } else if (code === 'PIN_NOT_SET') {
      switchMode('set');
    } else if (code === 'PIN_RESET_REQUIRED') {
      switchMode('reset');
    } else if (code === 'REAUTHENTICATION_REQUIRED') {
      setReauthRequired(true);
    } else {
      setError(messageOf(failure));
    }
  };

  const submit = () => {
    if (inFlight.current || !userId) return;
    const problem = validate(mode, currentPin, newPin, confirmPin);
    if (problem) {
      setError(problem);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    setReauthRequired(false);
    const request =
      mode === 'change'
        ? changeWalletPin({ currentPin, newPin }, userId)
        : submitWalletPin(mode, newPin, userId);
    clearFields();
    request
      .then(onSuccess)
      .catch(onFailure)
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return {
    gateState: gate.state,
    mode,
    currentPin,
    newPin,
    confirmPin,
    setCurrentPin,
    setNewPin,
    setConfirmPin,
    busy,
    error,
    notice,
    reauthRequired,
    submit,
    forgotPin: () => switchMode('reset'),
    confirmSignOut,
  };
}
