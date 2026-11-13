import { useNavigation } from 'expo-router';
import { useEffect, useRef } from 'react';

/**
 * Runs `refresh` each time the screen comes back into focus (not on the
 * first focus, which the screen's own load already covers). Settings uses it
 * so a PIN saved on the pushed Wallet PIN screen shows on return.
 */
export function useRefreshOnRefocus(refresh: () => void) {
  const navigation = useNavigation();
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    let seen = false;
    return navigation.addListener('focus', () => {
      if (seen) latest.current();
      seen = true;
    });
  }, [navigation]);
}
