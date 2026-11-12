import { sanitizeWalletReturnTo } from './sanitize-wallet-return-to';

// Purchases that spend the older wallet balance (store credit) and send the
// customer to a top-up that returns to them. Savings and wallet screens are
// never purchases: their money belongs in the PiggyVest savings wallet.
const PURCHASE_PATHS = ['/imei-check', '/utilities'] as const;

/**
 * True when a wallet top-up returns to a purchase that spends store credit
 * (IMEI checks, utilities). Such a top-up must add store credit, never fund
 * the PiggyVest savings wallet, which cannot pay for purchases yet.
 */
export function isWalletPurchaseReturnHref(value: unknown): boolean {
  const href = sanitizeWalletReturnTo(value);
  if (!href) return false;
  const path = href.split('?')[0] ?? '';
  return PURCHASE_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}
