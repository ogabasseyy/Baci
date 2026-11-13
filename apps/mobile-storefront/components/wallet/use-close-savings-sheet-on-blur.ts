import { useFocusEffect } from 'expo-router';
import { useRef } from 'react';

/**
 * The savings sheet is a modal: it would otherwise stay on top when another
 * screen opens over the wallet (a deep link, a notification tap). On blur
 * this runs the sheet's own close, the same cleanup as the customer closing
 * it (pickers reset, an unsent cancel/complete review dropped; an action
 * already in flight keeps its held state and refreshes when it settles).
 */
export function useCloseSavingsSheetOnBlur(
  visible: boolean,
  close: () => void
) {
  // Read at blur time, so the focus callback never changes identity (a new
  // callback would run its cleanup, i.e. close the sheet, on every render).
  const latest = useRef({ visible, close });
  latest.current = { visible, close };
  useFocusEffect(() => () => {
    if (latest.current.visible) latest.current.close();
  });
}
