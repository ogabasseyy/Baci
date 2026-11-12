import { router, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
export const MISMATCH_ERROR = 'The two PINs do not match.';
export const SAME_PIN_ERROR = 'Choose a different PIN from your current one.';
const FALLBACK_ERROR = 'Something went wrong. Please try again.';
const SUCCESS: Record<WalletPinMode, string> = {
  set: 'PIN set',
  change: 'PIN changed',
  reset: 'PIN reset',
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
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The saved state shown in place of the form (no system alert). Held per
  // account: another account signing in never sees this one's confirmation.
  const [saved, setSaved] = useState<{
    mode: WalletPinMode;
    userId: string;
  } | null>(null);
  // "Confirm it's you" before a new or reset PIN when the sign-in is old:
  // asked up front by the status read, or after a save refused for it (the
  // PIN chosen then is kept in a ref and saved once confirmed).
  // Held per account: another account never inherits a confirmation.
  const [identity, setIdentity] = useState<{
    userId: string | null;
    confirmed: boolean;
    forced: boolean;
  }>({ userId, confirmed: false, forced: false });
  const identityConfirmed = identity.userId === userId && identity.confirmed;
  const identityForced = identity.userId === userId && identity.forced;
  const pendingPin = useRef<{ mode: 'set' | 'reset'; pin: string } | null>(
    null
  );
  // A mode picked by the user or by an outcome only holds for the status it
  // was chosen against; a fresh status read decides again.
  const [override, setOverride] = useState<{
    mode: WalletPinMode;
    status: WalletPinStatus | null;
  } | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const screenActive = useRef(true);
  const requestGeneration = useRef(0);
  const currentUserId = useRef(userId);

  useLayoutEffect(() => {
    if (currentUserId.current === userId) return;
    currentUserId.current = userId;
    requestGeneration.current += 1;
    pendingPin.current = null;
  }, [userId]);

  const mode =
    override && override.status === gate.status
      ? override.mode
      : modeFromStatus(gate.status);
  const needsIdentity =
    mode !== 'change' &&
    !identityConfirmed &&
    (identityForced || gate.status?.signInConfirmationRequired === true);

  useEffect(() => {
    const invalidate = (clear: boolean) => {
      requestGeneration.current += 1;
      screenActive.current = false;
      pendingPin.current = null;
      if (clear) {
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
        setSaved(null);
      }
    };
    const unsubscribeBlur = navigation.addListener('blur', () =>
      invalidate(true)
    );
    const unsubscribeFocus = navigation.addListener('focus', () => {
      screenActive.current = true;
    });
    mounted.current = true;
    screenActive.current = true;
    return () => {
      invalidate(false);
      mounted.current = false;
      unsubscribeBlur();
      unsubscribeFocus();
    };
  }, [navigation]);

  const isRequestCurrent = (generation: number, requestUserId: string) =>
    mounted.current &&
    screenActive.current &&
    requestGeneration.current === generation &&
    currentUserId.current === requestUserId;

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

  const leaveScreen = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
    // Refresh in the background; navigation never waits for it.
    try {
      void Promise.resolve(gate.refresh()).catch(() => undefined);
    } catch {
      // A failed background refresh must not escape the Done handler.
    }
  };

  const onSuccess = (
    generation: number,
    requestUserId: string,
    savedMode: WalletPinMode
  ) => {
    if (!isRequestCurrent(generation, requestUserId)) return;
    setOverride({ mode: 'change', status: gate.status });
    setSaved({ mode: savedMode, userId: requestUserId });
  };

  const onFailure = (
    failure: unknown,
    generation: number,
    requestUserId: string,
    attempt: { mode: WalletPinMode; pin: string }
  ) => {
    if (!isRequestCurrent(generation, requestUserId)) return;
    const code = codeOf(failure);
    if (code === 'PIN_ALREADY_SET') {
      switchMode('change');
      gate.refresh();
    } else if (code === 'PIN_NOT_SET') {
      switchMode('set');
    } else if (code === 'PIN_RESET_REQUIRED') {
      switchMode('reset');
    } else if (
      code === 'REAUTHENTICATION_REQUIRED' &&
      attempt.mode !== 'change'
    ) {
      pendingPin.current = { mode: attempt.mode, pin: attempt.pin };
      setIdentity({ userId: requestUserId, confirmed: false, forced: true });
    } else {
      setError(messageOf(failure));
    }
  };

  const send = (attempt: { mode: WalletPinMode; pin: string }) => {
    if (inFlight.current || !userId) return;
    inFlight.current = true;
    const generation = requestGeneration.current;
    const requestUserId = userId;
    setBusy(true);
    setError(null);
    const request =
      attempt.mode === 'change'
        ? changeWalletPin({ currentPin, newPin: attempt.pin }, userId)
        : submitWalletPin(attempt.mode, attempt.pin, userId);
    clearFields();
    request
      .then(() => onSuccess(generation, requestUserId, attempt.mode))
      .catch((failure: unknown) =>
        onFailure(failure, generation, requestUserId, attempt)
      )
      .finally(() => {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      });
  };

  const submit = () => {
    if (inFlight.current || !userId) return;
    const problem = validate(mode, currentPin, newPin, confirmPin);
    if (problem) {
      setError(problem);
      return;
    }
    send({ mode, pin: newPin });
  };

  /** "Confirm it's you" succeeded: show the form, or save the kept PIN. */
  const identityConfirmedNow = () => {
    setIdentity({ userId, confirmed: true, forced: false });
    setError(null);
    const pending = pendingPin.current;
    pendingPin.current = null;
    if (pending) send(pending);
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
    /** Shows a step's own validation message (the steps hook decides). */
    showError: setError,
    /** The confirmation title once a PIN is saved, else null. */
    savedTitle: saved && saved.userId === userId ? SUCCESS[saved.mode] : null,
    /** Done on the saved state: back to Settings. */
    finish: leaveScreen,
    needsIdentity,
    userId,
    submit,
    forgotPin: () => switchMode('reset'),
    identityConfirmed: identityConfirmedNow,
  };
}
