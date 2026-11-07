import { Keyboard } from 'react-native';
import {
  KeyboardController,
  KeyboardEvents,
} from 'react-native-keyboard-controller';
import { markProductEntryTiming } from '@/lib/product-entry-timing';

/** Finish the keyboard resize before starting a native navigation transition. */
export function dismissKeyboardForNavigation(): Promise<void> {
  if (!KeyboardController.isVisible()) {
    Keyboard.dismiss();
    return Promise.resolve();
  }
  markProductEntryTiming('keyboard_hide_requested');
  return new Promise((resolve) => {
    let settled = false;
    let hidden = false;
    let frame: number | undefined;
    let layoutTimeout: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hideTimeout);
      clearTimeout(layoutTimeout);
      if (frame !== undefined) cancelAnimationFrame(frame);
      subscription.remove();
      resolve();
    };
    const subscription = KeyboardEvents.addListener('keyboardDidHide', () => {
      if (hidden || settled) return;
      hidden = true;
      markProductEntryTiming('keyboard_hidden');
      clearTimeout(hideTimeout);
      // Allow the resized window to lay out; still release if RAF is suspended.
      layoutTimeout = setTimeout(finish, 50);
      frame = requestAnimationFrame(finish);
    });
    const hideTimeout = setTimeout(() => {
      markProductEntryTiming('keyboard_hide_timeout');
      finish();
    }, 600);
    Keyboard.dismiss();
  });
}
