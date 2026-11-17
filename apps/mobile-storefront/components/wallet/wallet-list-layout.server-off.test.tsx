import { describe, expect, it } from '@jest/globals';
import { CHAT_WIDGET_FAB_SIZE } from '@/constants/layout';
import { walletListLayout } from './wallet-list-layout';

describe('wallet list layout', () => {
  it('shares one right inset and balances it on the left for centring', () => {
    expect(walletListLayout.aligned).toEqual({
      paddingLeft: 0,
      paddingRight: CHAT_WIDGET_FAB_SIZE + 8,
    });
    expect(walletListLayout.centred).toEqual({
      paddingLeft: CHAT_WIDGET_FAB_SIZE + 8,
    });
  });
});
