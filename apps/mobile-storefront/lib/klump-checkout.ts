import type {
  SavingsSelection,
  WalletSelection,
} from '@/lib/wallet-payment-helpers';

export interface KlumpPaymentSettings {
  klump_enabled?: boolean | null;
  klump_max_amount?: number | null;
  klump_min_amount?: number | null;
}

/** Retired globally; stale app state must not submit another Klump order. */
export function getKlumpDisabledReason(
  _settings: KlumpPaymentSettings | undefined | null,
  _orderTotal: number,
  _walletSelection?: WalletSelection,
  _savingsSelection?: SavingsSelection
): string {
  return 'Klump is no longer available. Choose another payment method.';
}

export function shouldHideKlumpPaymentMethod(
  _settings: KlumpPaymentSettings | undefined | null,
  _orderTotal: number
): boolean {
  return true;
}
