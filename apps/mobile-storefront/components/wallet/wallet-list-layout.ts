import { StyleSheet } from 'react-native';
import { CHAT_WIDGET_FAB_SIZE } from '@/constants/layout';

/**
 * The wallet's two lists (activity and older store credit) share one right
 * inset, so their amounts line up and stay clear of the floating AI button.
 */
const LIST_RIGHT_INSET = CHAT_WIDGET_FAB_SIZE + 8;

export const walletListLayout = StyleSheet.create({
  /** Same 16pt left edge as the wallet cards; amounts stop short of the button. */
  aligned: { paddingLeft: 0, paddingRight: LIST_RIGHT_INSET },
  /** Centred on the screen: pads the left by what the list gives up on the right. */
  centred: { paddingLeft: LIST_RIGHT_INSET },
});
