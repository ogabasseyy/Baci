import type { MutableRefObject } from 'react';
import type { LayoutChangeEvent, ScrollView } from 'react-native';
import { SPACING } from '@/constants/Colors';
import { detectNetwork } from '@/lib/network-utils';

const MIN_AIRTIME_AMOUNT = 50;
const MAX_AIRTIME_AMOUNT = 50_000;

export function sanitizePhoneDigits(text: string): string {
  return text.replace(/\D/g, '');
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
  scrollViewRef: MutableRefObject<ScrollView | null>;
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
