import { useRef } from 'react';
import { Alert } from 'react-native';
import {
  LOCAL_PHONE_DIGITS,
  PHONE_TRIMMED_NOTICE,
} from './airtime-form-controller.helpers';

/**
 * Tells the customer once per overflow that digits past one number were
 * dropped (Fable walk 15: the native field can still hold the extra digits
 * after the cut, so the next keystroke arrives overlong again and would
 * re-alert). Shown again only after the number is edited below 11 digits.
 */
export function usePhoneTrimNotice() {
  const shown = useRef(false);
  return (change: { digits: string; trimmed: boolean }) => {
    if (change.digits.length < LOCAL_PHONE_DIGITS) shown.current = false;
    if (!change.trimmed || shown.current) return;
    shown.current = true;
    Alert.alert(PHONE_TRIMMED_NOTICE.title, PHONE_TRIMMED_NOTICE.message);
  };
}
