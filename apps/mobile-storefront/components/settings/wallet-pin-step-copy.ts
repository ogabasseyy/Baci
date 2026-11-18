import type { WalletPinMode } from './use-wallet-pin-settings';
import type { WalletPinStage } from './use-wallet-pin-steps';

const ACTION: Record<WalletPinMode, string> = {
  set: 'Save PIN',
  change: 'Change PIN',
  reset: 'Reset PIN',
};

/** The words for each step of setting, changing or resetting a PIN. */
export function walletPinStepCopy(mode: WalletPinMode, stage: WalletPinStage) {
  if (stage === 'current')
    return { title: 'Enter your current PIN', hint: null, action: 'Continue' };
  if (stage === 'new')
    return {
      title: mode === 'set' ? 'Choose a wallet PIN' : 'Choose a new PIN',
      hint: '4 to 6 digits',
      action: 'Continue',
    };
  return {
    title: mode === 'set' ? 'Confirm your PIN' : 'Confirm your new PIN',
    hint: null,
    action: ACTION[mode],
  };
}
