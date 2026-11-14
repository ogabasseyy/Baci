import { describe, expect, it } from '@jest/globals';
import { useWalletFundPromptStore } from './wallet-fund-prompt-store';

describe('funding question store with the server keeping PiggyVest off', () => {
  it('starts with no question waiting, so nothing is drawn', () => {
    expect(useWalletFundPromptStore.getState().prompt).toBeNull();
  });
});
