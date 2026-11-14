import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

/**
 * The savings sheet is a modal: it would otherwise stay on top when another
 * screen opens over the wallet (a deep link, a notification tap). On blur
 * this runs the sheet's own close, the same cleanup as the customer closing
 * it (pickers reset, an unsent cancel/complete review dropped).
 *
 * While the sheet is locked (a cancel or complete is being sent) it is not
 * closed: a PIN re-prompt from that request must stay reachable. The close
 * then runs once the request settles, if the wallet is still out of focus.
 *
 * Listens to the navigation `blur` event, not `useFocusEffect`: a focus
 * effect whose callback changes identity re-runs its cleanup on every
 * render, which closed the sheet the moment it opened.
 */
export function useCloseSavingsSheetOnBlur(
  visible: boolean,
  close: () => void,
  locked = false
) {
  const navigation = useNavigation();
  const latest = useRef({ visible, close, locked });
  latest.current = { visible, close, locked };
  const [closeWhenUnlocked, setCloseWhenUnlocked] = useState(false);
  useEffect(() => {
    const offBlur = navigation.addListener('blur', () => {
      if (!latest.current.visible) return;
      if (latest.current.locked) setCloseWhenUnlocked(true);
      else latest.current.close();
    });
    const offFocus = navigation.addListener('focus', () =>
      setCloseWhenUnlocked(false)
    );
    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation]);
  useEffect(() => {
    if (!closeWhenUnlocked || locked) return;
    setCloseWhenUnlocked(false);
    if (latest.current.visible) latest.current.close();
  }, [closeWhenUnlocked, locked]);
}
