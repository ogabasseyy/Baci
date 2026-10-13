// Success-dialog copy for the loyalty redeem route (split out: the route
// sits at the 300-line limit). Single primary export
// (getRedemptionInstructions); the shapes travel with it because no other
// module consumes them.

import {
  formatAmountInCurrency,
  formatMerchantCurrency,
} from '@/lib/resolve-merchant-currency';

export interface RedemptionRewardSummary {
  reward_type: string;
  discount_type?: string;
  discount_value?: number;
  issuance_currency?: string | null;
}

export interface RedemptionMerchantCurrency {
  country?: string | null;
  payout_currency?: string | null;
}

export function getRedemptionInstructions(
  reward: RedemptionRewardSummary,
  merchantCurrency: RedemptionMerchantCurrency | null
): string {
  switch (reward.reward_type) {
    case 'discount': {
      // Plain discounts without a positive value stay redeemable (the
      // RPC's valued guard covers only the valued types), but neither
      // checkout entry point bridges them — so manual fulfillment, not
      // a checkout promise the wrapper must reject as not_applicable.
      if (reward.discount_value == null || reward.discount_value <= 0) {
        return 'Present this code to receive your discount. Contact the store for details.';
      }
      if (reward.discount_type === 'percentage') {
        return `Apply this code at checkout to receive ${reward.discount_value}% off your order.`;
      }
      // The issuance snapshot wins over the merchant's current
      // currency: the value is denominated at mint, and checkout
      // rejects the code if the merchant has since moved.
      if (reward.issuance_currency) {
        return `Apply this code at checkout to receive ${formatAmountInCurrency(
          reward.discount_value ?? 0,
          reward.issuance_currency,
          { maximumFractionDigits: 0 }
        )} off your order.`;
      }
      // Null currency means the merchant lookup failed: currency-neutral
      // copy beats a false NGN label on a non-NGN merchant's dialog.
      if (merchantCurrency == null) {
        return 'Apply this code at checkout to receive a fixed-amount discount off your order.';
      }
      // Same formatter as the rewards catalog: fixed-value labels render
      // in the merchant's own payout currency (NGN fallback matches the
      // previous hardcoded symbol when the merchant row is simply absent).
      return `Apply this code at checkout to receive ${formatMerchantCurrency(
        reward.discount_value ?? 0,
        {
          country: merchantCurrency.country ?? null,
          payout_currency: merchantCurrency.payout_currency ?? null,
        },
        { maximumFractionDigits: 0 }
      )} off your order.`;
    }
    case 'free_shipping':
      // Manual fulfillment: the checkout bridge accepts discount codes only.
      return 'Present this code to receive free shipping on your order. Contact the store for details.';
    case 'free_product':
      return 'Present this code to claim your free product. Contact the store for details.';
    case 'exclusive_access':
      return 'This code grants you early access to new products and exclusive sales.';
    case 'store_credit':
      return 'The credit has been added to your store balance. Enable Wallet Credit at checkout to apply it to your order.';
    default:
      return 'Apply this code at checkout or present it in-store to redeem your reward.';
  }
}
