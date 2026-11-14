import { walletPinStepCopy } from './wallet-pin-step-copy';

describe('PIN step words', () => {
  it('asks for the current PIN first when changing', () => {
    expect(walletPinStepCopy('change', 'current')).toEqual({
      title: 'Enter your current PIN',
      hint: null,
      action: 'Continue',
    });
  });

  it('names the save action only on the last step', () => {
    expect(walletPinStepCopy('set', 'new').action).toBe('Continue');
    expect(walletPinStepCopy('set', 'confirm').action).toBe('Save PIN');
    expect(walletPinStepCopy('change', 'confirm').action).toBe('Change PIN');
    expect(walletPinStepCopy('reset', 'confirm').action).toBe('Reset PIN');
  });

  it('says "wallet PIN" for a first PIN and "new PIN" otherwise', () => {
    expect(walletPinStepCopy('set', 'new').title).toBe('Choose a wallet PIN');
    expect(walletPinStepCopy('reset', 'new').title).toBe('Choose a new PIN');
    expect(walletPinStepCopy('change', 'confirm').title).toBe(
      'Confirm your new PIN'
    );
  });
});
