import type { AlertButton } from 'react-native';

type AlertShaped = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: object
) => void;

/**
 * Test-only: replays the inline wallet notice and funding question through
 * one Alert-shaped spy, so older funding tests keep asserting the same
 * titles, messages and button presses. A question resolves with the button
 * the spy presses (declined when it presses none and the question is
 * dropped).
 */
export function alertShapedTestBridge(spy: AlertShaped) {
  return {
    notify: (title: string, message?: string) => spy(title, message),
    ask: (title: string, message: string, confirmLabel: string) =>
      new Promise<boolean>((resolve) =>
        spy(
          title,
          message,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: confirmLabel, onPress: () => resolve(true) },
          ],
          { cancelable: true }
        )
      ),
  };
}
