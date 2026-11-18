import { StyleSheet } from 'react-native';

/**
 * The wallet's two list cards (Wallet activity and Older store credit) use
 * one inner inset on both sides, the same as the card's own padding: title,
 * rows, dividers and amounts line up on the same left and right edges, and
 * rows and dividers span the full inner width. (An earlier extra right inset
 * for the floating AI button left the rows and dividers ending ~65pt short of
 * the card edge and the text flush with its left edge.)
 */
export const WALLET_LIST_INSET = 20;

export const walletListLayout = StyleSheet.create({
  /** The card's inner padding, equal on both sides. */
  aligned: {
    paddingLeft: WALLET_LIST_INSET,
    paddingRight: WALLET_LIST_INSET,
  },
  /** Loading and empty states sit centred in that same inner width. */
  centred: { paddingLeft: 0, paddingRight: 0 },
});
