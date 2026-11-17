import { formatPrice } from '@/stores/cart-store';

export interface WalletCreditCopy {
  autoApplyLabel: string;
  coversFullyLabel: string;
  partialLabel: string;
  sourceName: string;
  accessibilityLabel: (input: {
    balance: number;
    coversFully: boolean;
    portion: number;
    total: number;
  }) => string;
}

function buildCopy(
  coversFullyLabel: string,
  partialLabel: string,
  sourceName: string,
  autoApplyLabel: string
): WalletCreditCopy {
  return {
    accessibilityLabel: ({ balance, coversFully, portion, total }) =>
      coversFully
        ? `${coversFullyLabel}, ${formatPrice(balance)} available`
        : `${partialLabel}, ${formatPrice(portion)} of ${formatPrice(total)}`,
    autoApplyLabel,
    coversFullyLabel,
    partialLabel,
    sourceName,
  };
}

const WALLET_COPY = buildCopy(
  'Pay with wallet',
  'Use wallet credit',
  'wallet',
  'Wallet balance applies automatically'
);

// PiggyVest customers spend store credit (their older wallet balance) at
// checkout; their PiggyVest savings wallet cannot pay for orders yet.
const STORE_CREDIT_COPY = buildCopy(
  'Pay with store credit',
  'Use store credit',
  'store credit',
  'Store credit applies automatically'
);

export function getWalletCreditCopy(storeCredit: boolean): WalletCreditCopy {
  return storeCredit ? STORE_CREDIT_COPY : WALLET_COPY;
}
