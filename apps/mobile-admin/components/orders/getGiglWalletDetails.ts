import { formatMerchantPrice } from '@/lib/format-merchant-currency';
import type { ShipmentOptionDetail } from './ShipmentOptionCard';

export interface GiglWalletSummary {
  availableBalance: number;
  canBook: boolean;
  paidByBaci?: boolean;
  shortfall: number;
}

const formatPrice = (amount: number) =>
  formatMerchantPrice(amount, { payout_currency: 'NGN' });

// The balance only matters when it cannot cover the delivery.
export function getGiglWalletDetails(
  wallet: GiglWalletSummary | null
): ShipmentOptionDetail[] {
  if (!wallet) return [];
  // Baci pays: never a top-up prompt; only claim it when booking is allowed.
  if (wallet.paidByBaci)
    return wallet.canBook ? [{ text: 'Paid by Baci' }] : [];
  if (wallet.canBook) return [{ text: 'From your wallet' }];
  return [
    { text: `Wallet balance: ${formatPrice(wallet.availableBalance)}` },
    {
      text: `Top up ${formatPrice(wallet.shortfall)} to book`,
      tone: 'warning',
    },
  ];
}
