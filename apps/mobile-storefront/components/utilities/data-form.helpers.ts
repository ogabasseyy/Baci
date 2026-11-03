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
