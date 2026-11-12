import { useState } from 'react';
import {
  MISMATCH_ERROR,
  SAME_PIN_ERROR,
  type useWalletPinSettings,
  type WalletPinMode,
} from './use-wallet-pin-settings';

export type WalletPinStage = 'current' | 'new' | 'confirm';

type PinSettings = Pick<
  ReturnType<typeof useWalletPinSettings>,
  | 'mode'
  | 'busy'
  | 'currentPin'
  | 'newPin'
  | 'confirmPin'
  | 'setCurrentPin'
  | 'setNewPin'
  | 'setConfirmPin'
  | 'showError'
  | 'submit'
>;

const MIN_DIGITS = 4;

const firstStage = (mode: WalletPinMode): WalletPinStage =>
  mode === 'change' ? 'current' : 'new';

/**
 * One PIN at a time, as in the savings sheet: the current PIN (when
 * changing), then the new one, then the same again. Saving still goes
 * through the settings hook's full check, so no step can skip it.
 */
export function useWalletPinSteps(pin: PinSettings) {
  const [held, setHeld] = useState<{
    stage: WalletPinStage;
    mode: WalletPinMode;
  }>({ stage: firstStage(pin.mode), mode: pin.mode });
  // A new form (set, change or reset) always starts at its first step.
  const stage = held.mode === pin.mode ? held.stage : firstStage(pin.mode);
  const go = (next: WalletPinStage) => setHeld({ stage: next, mode: pin.mode });

  const value =
    stage === 'current'
      ? pin.currentPin
      : stage === 'new'
        ? pin.newPin
        : pin.confirmPin;
  const setter =
    stage === 'current'
      ? pin.setCurrentPin
      : stage === 'new'
        ? pin.setNewPin
        : pin.setConfirmPin;
  const ready = value.length >= MIN_DIGITS && !pin.busy;

  const advance = () => {
    if (!ready) return;
    if (stage === 'current') return go('new');
    if (stage === 'new') {
      if (pin.mode === 'change' && pin.newPin === pin.currentPin) {
        pin.setNewPin('');
        return pin.showError(SAME_PIN_ERROR);
      }
      return go('confirm');
    }
    if (pin.confirmPin !== pin.newPin) {
      pin.setNewPin('');
      pin.setConfirmPin('');
      pin.showError(MISMATCH_ERROR);
      return go('new');
    }
    pin.submit();
    // Whatever the answer, a later attempt starts again from the top (the
    // settings hook clears every PIN once a request goes out).
    go(firstStage(pin.mode));
  };

  return {
    stage,
    value,
    setValue: (next: string) => {
      pin.showError(null);
      setter(next);
    },
    ready,
    advance,
    /** "Forgot your PIN?" and any outcome that changes the form restart it. */
    restart: () => go(firstStage(pin.mode)),
  };
}
