import { describe, expect, it, jest } from '@jest/globals';
import { answerWalletFundPrompt } from './answer-wallet-fund-prompt';
import { useWalletFundPromptStore } from './wallet-fund-prompt-store';

describe('answering a funding question with the server keeping PiggyVest off', () => {
  it('does nothing when no question is waiting', () => {
    expect(() => answerWalletFundPrompt(true)).not.toThrow();
    expect(useWalletFundPromptStore.getState().prompt).toBeNull();
  });

  it('answers a waiting question once and removes it', () => {
    const resolve = jest.fn();
    useWalletFundPromptStore.setState({
      prompt: {
        title: 'We couldn’t check your wallet',
        message: 'Nothing was charged.',
        confirmLabel: 'Try again',
        scope: 'u:m',
        resolve,
      },
    });

    answerWalletFundPrompt(true);
    answerWalletFundPrompt(false);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(true);
    expect(useWalletFundPromptStore.getState().prompt).toBeNull();
  });
});
