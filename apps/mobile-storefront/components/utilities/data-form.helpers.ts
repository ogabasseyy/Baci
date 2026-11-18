import type { ScrollViewInstance } from 'react-native';
import { SPACING } from '@/constants/Colors';

export type DataProvider = 'mtn' | 'airtel' | 'glo' | 't2';

export function inferProviderFromDataBillerName(
  name: string
): DataProvider | null {
  const normalizedName = name.toLowerCase();

  if (normalizedName.includes('mtn')) {
    return 'mtn';
  }
  if (normalizedName.includes('airtel')) {
    return 'airtel';
  }
  if (normalizedName.includes('glo')) {
    return 'glo';
  }
  if (
    normalizedName.includes('9mobile') ||
    normalizedName.includes('9 mobile') ||
    normalizedName.includes('etisalat') ||
    normalizedName.includes('t2')
  ) {
    return 't2';
  }

  return null;
}

export function scrollToDataPayment(
  paymentY: number,
  scrollView: ScrollViewInstance | null
) {
  requestAnimationFrame(() => {
    scrollView?.scrollTo({
      animated: true,
      y: Math.max(paymentY - SPACING.md, 0),
    });
  });
}

/**
 * Records where the data form's payment section sits and, once, scrolls to it
 * (a repeat purchase opens ready to pay).
 */
export function handleDataPaymentLayout({
  paymentY,
  paymentYRef,
  scrollView,
  shouldScrollToPaymentRef,
}: {
  paymentY: number;
  paymentYRef: { current: number | null };
  scrollView: ScrollViewInstance | null;
  shouldScrollToPaymentRef: { current: boolean };
}) {
  paymentYRef.current = paymentY;
  if (!shouldScrollToPaymentRef.current) {
    return;
  }
  shouldScrollToPaymentRef.current = false;
  scrollToDataPayment(paymentY, scrollView);
}

/** The bundle list's error line when the data billers failed to load. */
export function getDataPlansErrorMessage(
  hasPlansError: boolean,
  plansError: unknown
): string | undefined {
  if (!hasPlansError) return undefined;
  return plansError instanceof Error
    ? plansError.message
    : 'Could not load data bundles. Please try again.';
}
