import { formatServicePrice } from './format-service-price';
import type { ImeiWalletCopy } from './imei-wallet-copy';

/**
 * The footer button's words: what the next tap does. Paying from the savings
 * wallet names the check it pays for, because the preselected card can sit
 * below the fold (Fable walk 15); the savings badge beside it shows where the
 * money comes from.
 */
export function imeiVerifyButtonLabel(input: {
  hasTier: boolean;
  isWalletLoading: boolean;
  isWalletError: boolean;
  needsTopUp: boolean;
  paysFromPiggyvest: boolean;
  walletCopy: ImeiWalletCopy;
  tier: { price: number; name: string };
}): string {
  if (!input.hasTier) return 'Choose a check';
  if (input.isWalletLoading) return input.walletCopy.loadingButton;
  if (input.isWalletError) return input.walletCopy.unavailableButton;
  if (input.needsTopUp) return input.walletCopy.topUpButton;
  const price = formatServicePrice(input.tier.price);
  return input.paysFromPiggyvest
    ? `Pay ${price} for ${input.tier.name}`
    : `Verify Now - ${price}`;
}
