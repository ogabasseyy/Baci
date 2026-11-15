import { describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { answerWalletFundPrompt } from './answer-wallet-fund-prompt';
import { askWalletFund } from './ask-wallet-fund';
import { useWalletFundPromptStore } from './wallet-fund-prompt-store';

const mockAuth = { user: { id: 'customer-1' }, merchantId: 'store-1' };
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => mockAuth },
}));

describe('asking a funding question with the server keeping PiggyVest off', () => {
  it('asks inline for the signed-in account, never with an iOS alert', async () => {
    const iosAlert = jest.spyOn(Alert, 'alert');
    const answer = askWalletFund('Title', 'Message', 'Try again');

    expect(useWalletFundPromptStore.getState().prompt).toMatchObject({
      title: 'Title',
      message: 'Message',
      confirmLabel: 'Try again',
      scope: 'customer-1:store-1',
    });
    answerWalletFundPrompt(true);
    await expect(answer).resolves.toBe(true);
    expect(iosAlert).not.toHaveBeenCalled();
  });

  it('declines an older question when a newer one replaces it', async () => {
    const older = askWalletFund('Older', 'Message', 'Yes');
    const newer = askWalletFund('Newer', 'Message', 'Yes');

    await expect(older).resolves.toBe(false);
    expect(useWalletFundPromptStore.getState().prompt?.title).toBe('Newer');
    answerWalletFundPrompt(false);
    await expect(newer).resolves.toBe(false);
  });
});
