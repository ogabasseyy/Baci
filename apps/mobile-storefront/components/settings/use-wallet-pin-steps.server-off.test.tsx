import { act, renderHook } from '@testing-library/react-native';
import { useState } from 'react';
import type { WalletPinMode } from './use-wallet-pin-settings';
import { useWalletPinSteps } from './use-wallet-pin-steps';

// A stand-in for the settings hook: the steps decide nothing about saving,
// they only hand a complete form to `submit` (which the server can refuse).
function useFakeSettings(mode: WalletPinMode, submit: () => void) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, showError] = useState<string | null>(null);
  return {
    mode,
    busy: false,
    currentPin,
    newPin,
    confirmPin,
    setCurrentPin,
    setNewPin,
    setConfirmPin,
    showError,
    submit,
    error,
  };
}

function setup(mode: WalletPinMode) {
  const submit = jest.fn();
  const view = renderHook(() => {
    const pin = useFakeSettings(mode, submit);
    return { pin, steps: useWalletPinSteps(pin) };
  });
  const enter = (digits: string) => {
    act(() => view.result.current.steps.setValue(digits));
    act(() => view.result.current.steps.advance());
  };
  return { view, submit, enter };
}

describe('PIN steps with the server off', () => {
  it('walks current, new, confirm, then hands the form to submit once', () => {
    const { view, submit, enter } = setup('change');
    expect(view.result.current.steps.stage).toBe('current');
    enter('1234');
    expect(view.result.current.steps.stage).toBe('new');
    enter('5678');
    expect(view.result.current.steps.stage).toBe('confirm');
    enter('5678');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(view.result.current.steps.stage).toBe('current');
  });

  it('goes back one step at a time, clearing the step it leaves', () => {
    const { view, enter } = setup('change');
    expect(view.result.current.steps.canGoBack).toBe(false);
    enter('1234');
    enter('5678');
    expect(view.result.current.steps.stage).toBe('confirm');
    act(() => view.result.current.steps.back());
    expect(view.result.current.steps.stage).toBe('new');
    expect(view.result.current.pin.newPin).toBe('5678');
    act(() => view.result.current.steps.back());
    expect(view.result.current.steps.stage).toBe('current');
    expect(view.result.current.pin.newPin).toBe('');
    expect(view.result.current.pin.currentPin).toBe('1234');
    expect(view.result.current.steps.canGoBack).toBe(false);
  });

  it('does not move on before four digits', () => {
    const { view, enter } = setup('set');
    enter('123');
    expect(view.result.current.steps.stage).toBe('new');
    expect(view.result.current.steps.ready).toBe(false);
  });

  it('a mismatch clears both PINs and goes back to choosing', () => {
    const { view, submit, enter } = setup('set');
    enter('1234');
    enter('4321');
    expect(submit).not.toHaveBeenCalled();
    expect(view.result.current.steps.stage).toBe('new');
    expect(view.result.current.pin.newPin).toBe('');
    expect(view.result.current.pin.error).toBe('The two PINs do not match.');
  });

  it('refuses a new PIN equal to the current one', () => {
    const { view, enter } = setup('change');
    enter('1234');
    enter('1234');
    expect(view.result.current.steps.stage).toBe('new');
    expect(view.result.current.pin.error).toBe(
      'Choose a different PIN from your current one.'
    );
  });
});
