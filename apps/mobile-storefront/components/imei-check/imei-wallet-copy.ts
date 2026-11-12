import { formatServicePrice } from './format-service-price';

export interface ImeiWalletCopy {
  balanceLabel: (balance: number) => string;
  badgePrefix: string | null;
  loading: string;
  loadingButton: string;
  shortfallHint: (shortfall: number) => string;
  topUpButton: string;
  unavailable: string;
  unavailableButton: string;
}

const WALLET_COPY: ImeiWalletCopy = {
  balanceLabel: (balance) => `Wallet balance ${formatServicePrice(balance)}`,
  badgePrefix: null,
  loading: 'Loading wallet balance...',
  loadingButton: 'Loading wallet...',
  shortfallHint: (shortfall) =>
    `Balance low — top up ${formatServicePrice(shortfall)} to run this check`,
  topUpButton: 'Top up to unlock',
  unavailable: 'Wallet balance unavailable. Refresh your wallet and try again.',
  unavailableButton: 'Wallet unavailable',
};

// PiggyVest customers pay IMEI checks from store credit (their older wallet
// balance). Their PiggyVest savings wallet cannot pay for checks yet.
const STORE_CREDIT_COPY: ImeiWalletCopy = {
  balanceLabel: (balance) => `Store credit ${formatServicePrice(balance)}`,
  badgePrefix: 'Store credit',
  loading: 'Loading store credit...',
  loadingButton: 'Loading store credit...',
  shortfallHint: (shortfall) =>
    `Add ${formatServicePrice(shortfall)} store credit by card to run this check`,
  topUpButton: 'Add store credit',
  unavailable: 'Store credit unavailable. Refresh your wallet and try again.',
  unavailableButton: 'Store credit unavailable',
};

export function getImeiWalletCopy(storeCredit: boolean): ImeiWalletCopy {
  return storeCredit ? STORE_CREDIT_COPY : WALLET_COPY;
}
