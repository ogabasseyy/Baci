import type { MutableRefObject } from 'react';
import type { LayoutChangeEvent, ScrollViewInstance } from 'react-native';
import { SPACING } from '@/constants/Colors';
import { detectNetwork } from '@/lib/network-utils';

const MIN_AIRTIME_AMOUNT = 50;
const MAX_AIRTIME_AMOUNT = 50_000;

/** A Nigerian mobile number in local form: 0 and ten digits. */
export const LOCAL_PHONE_DIGITS = 11;

/**
 * The digits of a typed or pasted phone number, at most one local number
 * long (Fable: the field took 18 digits when typed text arrived late). An
 * international +234 number becomes its local 0 form first, so a paste is
 * never cut to the wrong eleven digits.
 */
export function sanitizePhoneDigits(text: string): string {
  const digits = text.replace(/\D/g, '');
  const local =
    digits.startsWith('234') && digits.length > LOCAL_PHONE_DIGITS
      ? `0${digits.slice(3)}`
      : digits;
  return local.slice(0, LOCAL_PHONE_DIGITS);
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
