import { useNavigation } from 'expo-router';
import { useEffect, useRef } from 'react';

/**
 * Runs `refresh` each time the screen comes back into focus after having
 * been left (a blur, then a focus). The initial focus is never replayed to a
 * new listener, so tracking the blur is what tells a return apart. Settings
 * uses it so a PIN saved on the pushed Wallet PIN screen shows on return.
 */
export function useRefreshOnRefocus(refresh: () => void) {
  const navigation = useNavigation();
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    let left = false;
    const offBlur = navigation.addListener('blur', () => {
      left = true;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (!left) return;
      left = false;
      latest.current();
    });
    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation]);
}
