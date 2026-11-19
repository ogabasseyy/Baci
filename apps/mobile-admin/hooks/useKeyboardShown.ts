import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';
import { isRuntimePlatform } from '@/config/runtime-platform';

/**
 * Whether the software keyboard is up. Moving focus between fields keeps it
 * true, so layout keyed on it does not shift while the user switches fields.
 */
export function useKeyboardShown() {
  const [isShown, setIsShown] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    // iOS reports the keyboard before it animates; Android only after.
    const isIos = isRuntimePlatform('ios');
    const showSubscription = Keyboard.addListener(
      isIos ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsShown(true)
    );
    const hideSubscription = Keyboard.addListener(
      isIos ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsShown(false)
    );
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return isShown;
}
