import type { MutableRefObject } from 'react';
import type { LayoutChangeEvent, ScrollViewInstance } from 'react-native';
import { SPACING } from '@/constants/Colors';
import { detectNetwork } from '@/lib/network-utils';

const MIN_AIRTIME_AMOUNT = 50;
const MAX_AIRTIME_AMOUNT = 50_000;

/** A Nigerian mobile number in local form: 0 and ten digits. */
export const LOCAL_PHONE_DIGITS = 11;

/**
 * The digits of a typed or pasted phone number. A number written with the
 * +234 country code becomes its local 0 form whatever its length, so cutting
 * it to 11 digits later never leaves a 234-prefixed number that looks local
 * (Muse).
 */
export function sanitizePhoneDigits(text: string): string {
  const digits = text.replace(/\D/g, '');
  return digits.startsWith('234') && digits.length > LOCAL_PHONE_DIGITS
    ? `0${digits.slice(3)}`
    : digits;
}

/** What the customer is told when digits beyond one number were dropped. */
export const PHONE_TRIMMED_NOTICE = {
  title: 'Check the phone number',
  message:
    'We kept the first 11 digits. Please check the number before you pay.',
};

/**
 * The field's next value: never more than one 11-digit number, however fast
 * the text arrives (Fable walks 13 and 14: bursts of late text held 12 or
 * 13 digits). One keystroke past a full number is simply ignored, like a
 * maximum length; a paste or a burst that loses digits is `trimmed`, so the
 * customer is told and checks the number instead of it being cut silently
 * (Muse).
 */
export function nextPhoneDigits(previous: string, text: string) {
  const all = sanitizePhoneDigits(text);
  return {
    digits: all.slice(0, LOCAL_PHONE_DIGITS),
    trimmed:
      all.length > LOCAL_PHONE_DIGITS &&
      !(
        previous.length === LOCAL_PHONE_DIGITS &&
        all.length === LOCAL_PHONE_DIGITS + 1
      ),
  };
}

/** The refusal for a number that is not one 11-digit local number. */
export function phoneLengthError(phoneNumber: string) {
  // One local number: 0 and ten digits, nothing else (Muse).
  return /^0\d{10}$/.test(phoneNumber.replace(/\D/g, ''))
    ? null
    : {
        title: 'Check the phone number',
        message: 'Enter an 11-digit phone number, like 08012345678.',
      };
}

export function resolveAirtimeProvider(phoneNumber: string): string | null {
  const digits = sanitizePhoneDigits(phoneNumber);
  if (!digits) return null;
  return detectNetwork(digits);
}

export function sanitizeAirtimeAmountInput(value: string): string {
  return value.replace(/\D/g, '');
}

export function validateAirtimePurchaseInput({
  amount,
  numericAmount,
  phoneNumber,
  selectedProvider,
}: {
  amount: string;
  numericAmount: number;
  phoneNumber: string;
  selectedProvider: string | null;
}): { message: string; title: string } | null {
  if (!selectedProvider || !phoneNumber || !amount) {
    return {
      title: 'Missing Information',
      message: 'Please fill in all fields.',
    };
  }
  const phoneError = phoneLengthError(phoneNumber);
  if (phoneError) return phoneError;

  if (
    numericAmount < MIN_AIRTIME_AMOUNT ||
    numericAmount > MAX_AIRTIME_AMOUNT
  ) {
    return {
      title: 'Invalid Amount',
      message: 'Amount must be between ₦50 and ₦50,000.',
    };
  }

  return null;
}

export function getAirtimeCustomerName(
  customer:
    | {
        email?: string | null;
        first_name?: string | null;
        last_name?: string | null;
      }
    | null
    | undefined
): string {
  return (
    [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ||
    customer?.email ||
    'Customer'
  );
}

export function scrollToAirtimePaymentSection({
  event,
  scrollViewRef,
  setShouldScrollToPayment,
  shouldScrollToPayment,
}: {
  event: LayoutChangeEvent;
  scrollViewRef: MutableRefObject<ScrollViewInstance | null>;
  setShouldScrollToPayment: (value: boolean) => void;
  shouldScrollToPayment: boolean;
}) {
  if (!shouldScrollToPayment) {
    return;
  }
  const paymentY = event.nativeEvent.layout.y;
  setShouldScrollToPayment(false);
  requestAnimationFrame(() => {
    scrollViewRef.current?.scrollTo({
      animated: true,
      y: Math.max(paymentY - SPACING.md, 0),
    });
  });
}
