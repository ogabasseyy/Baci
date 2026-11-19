import { describe, expect, it } from '@jest/globals';
import { WALLET_LIST_INSET, walletListLayout } from './wallet-list-layout';

// Pure layout: no server call, so it is the same with PiggyVest on or off.
describe('wallet list layout', () => {
  it('bugfix: uses one equal inner inset on both sides of the list cards', () => {
    expect(walletListLayout.aligned).toEqual({
      paddingLeft: WALLET_LIST_INSET,
      paddingRight: WALLET_LIST_INSET,
    });
    expect(walletListLayout.centred).toEqual({
      paddingLeft: 0,
      paddingRight: 0,
    });
  });
});
