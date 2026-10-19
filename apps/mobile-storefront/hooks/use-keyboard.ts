/**
 * Keyboard Handling Hook
 *
 * 2026 Best Practices for React Native Keyboard Handling:
 * - Provides keyboard visibility state
 * - Offers programmatic keyboard dismiss
 * - Handles keyboard events efficiently
 * - Works across iOS and Android
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

interface UseKeyboardResult {
  /** Whether keyboard is currently visible */
  isKeyboardVisible: boolean;
  /** Current keyboard height */
  keyboardHeight: number;
  /** Window-coordinate top edge of the keyboard, or null when hidden */
  keyboardTop: number | null;
  /** Dismiss the keyboard programmatically */
  dismissKeyboard: () => void;
  /** Wrap a submit handler to dismiss keyboard before execution */
  // biome-ignore lint/suspicious/noExplicitAny: generic function wrapper requires any[] for contravariant parameter compatibility
  withKeyboardDismiss: <T extends (...args: any[]) => any>(handler: T) => T;
}

/**
 * Hook for managing keyboard state and interactions
 *
 * @example
 * ```tsx
 * const { dismissKeyboard, withKeyboardDismiss } = useKeyboard();
 *
 * const handleSubmit = withKeyboardDismiss(() => {
 *   // Form submission logic
 * });
 * ```
 */
export function useKeyboard(): UseKeyboardResult {
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);

  useEffect(() => {
    // Use different events for iOS vs Android
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setIsKeyboardVisible(true);
      setKeyboardHeight(event.endCoordinates.height);
      setKeyboardTop(event.endCoordinates.screenY);
    });

    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardVisible(false);
      setKeyboardHeight(0);
      setKeyboardTop(null);
    });

    const frameSubscription = Keyboard.addListener(
      'keyboardWillChangeFrame',
      (event) => {
        if (event.endCoordinates.height > 0) {
          setKeyboardHeight(event.endCoordinates.height);
          setKeyboardTop(event.endCoordinates.screenY);
        }
      }
    );
    return () => {
      frameSubscription.remove();
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const dismissKeyboard = () => {
    Keyboard.dismiss();
  };

  /**
   * Wraps a handler function to dismiss keyboard before execution
   * This is a 2026 best practice for form submission UX
   */
  // biome-ignore lint/suspicious/noExplicitAny: generic function wrapper requires any[] for contravariant parameter compatibility
  const withKeyboardDismiss = <T extends (...args: any[]) => any>(
    handler: T
  ): T => {
    return ((...args: Parameters<T>) => {
      Keyboard.dismiss();
      return handler(...args);
    }) as T;
  };

  return {
    isKeyboardVisible,
    keyboardHeight,
    keyboardTop,
    dismissKeyboard,
    withKeyboardDismiss,
  };
}

/**
 * iOS TextContentType values for proper autofill
 *
 * 2026 Best Practice: Always set textContentType for iOS autofill to work properly
 * This enables Password AutoFill, Contact AutoFill, and Credit Card AutoFill
 */
export const TextContentTypes = {
  // Names
  name: 'name',
  namePrefix: 'namePrefix',
  givenName: 'givenName',
  middleName: 'middleName',
  familyName: 'familyName',
  nameSuffix: 'nameSuffix',
  nickname: 'nickname',

  // Contact
  emailAddress: 'emailAddress',
  telephoneNumber: 'telephoneNumber',

  // Address
  streetAddressLine1: 'streetAddressLine1',
  streetAddressLine2: 'streetAddressLine2',
  addressCity: 'addressCity',
  addressState: 'addressState',
  addressCityAndState: 'addressCityAndState',
  postalCode: 'postalCode',
  countryName: 'countryName',
  fullStreetAddress: 'fullStreetAddress',

  // Authentication
  username: 'username',
  password: 'password',
  newPassword: 'newPassword',
  oneTimeCode: 'oneTimeCode',

  // Credit Card
  creditCardNumber: 'creditCardNumber',
  creditCardExpiration: 'creditCardExpiration',
  creditCardExpirationMonth: 'creditCardExpirationMonth',
  creditCardExpirationYear: 'creditCardExpirationYear',
  creditCardSecurityCode: 'creditCardSecurityCode',
  creditCardType: 'creditCardType',
  creditCardName: 'creditCardName',
  creditCardGivenName: 'creditCardGivenName',
  creditCardMiddleName: 'creditCardMiddleName',
  creditCardFamilyName: 'creditCardFamilyName',
} as const;

export type TextContentType =
  (typeof TextContentTypes)[keyof typeof TextContentTypes];
