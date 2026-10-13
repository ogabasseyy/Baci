import { AIRPORT_DELIVERY_FEES } from '@baci/shared/constants';
import { AUTO_FRACTION_OPTIONS } from '@/lib/currency';
import { formatAmountInCurrency } from '@/lib/resolve-merchant-currency';

export const AIRPORT_DELIVERY_CONFIG = {
  delivery: {
    price: AIRPORT_DELIVERY_FEES.delivery,
    priceLabel: formatAmountInCurrency(
      AIRPORT_DELIVERY_FEES.delivery,
      'NGN',
      AUTO_FRACTION_OPTIONS,
    ),
  },
  pickup: {
    price: AIRPORT_DELIVERY_FEES.pickup,
    priceLabel: formatAmountInCurrency(
      AIRPORT_DELIVERY_FEES.pickup,
      'NGN',
      AUTO_FRACTION_OPTIONS,
    ),
  },
} as const;
