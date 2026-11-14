import type { MutableRefObject } from 'react';
import type { LayoutChangeEvent, ScrollViewInstance } from 'react-native';
import { SPACING } from '@/constants/Colors';
import { detectNetwork } from '@/lib/network-utils';

const MIN_AIRTIME_AMOUNT = 50;
const MAX_AIRTIME_AMOUNT = 50_000;

/** A Nigerian mobile number in local form: 0 and ten digits. */
export const LOCAL_PHONE_DIGITS = 11;

/**
 * The digits of a typed or pasted phone number. An international +234
 * number becomes its local 0 form. Never cut short: a number that is too
 * long is refused at purchase, never quietly sent to someone else (Muse).
 */
export function sanitizePhoneDigits(text: string): string {
  const digits = text.replace(/\D/g, '');
  return digits.startsWith('234') && digits.length === LOCAL_PHONE_DIGITS + 2
    ? `0${digits.slice(3)}`
    : digits;
}

/**
 * The field's next value. Typing past a complete 11-digit number is ignored,
 * like a maximum length (Fable: the field took 18 digits when typed text
 * arrived late). Anything else, an overlong paste included, is kept as
 * entered so the purchase check can refuse it.
 */
export function nextPhoneDigits(previous: string, text: string): string {
  const digits = sanitizePhoneDigits(text);
  return previous.length === LOCAL_PHONE_DIGITS &&
    digits.length > LOCAL_PHONE_DIGITS &&
    digits.startsWith(previous)
    ? previous
    : digits;
}

/** The refusal for a number that is not one 11-digit local number. */
export function phoneLengthError(phoneNumber: string) {
  return phoneNumber.replace(/\D/g, '').length === LOCAL_PHONE_DIGITS
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
