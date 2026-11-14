import { Alert, type AlertButton } from 'react-native';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import type { SavingsNoticeTone } from '../savings/savings-notice-store';

/** What a merchant without PiggyVest has always seen: an iOS alert. */
export type LegacyWalletAlert = {
  title: string;
  message?: string;
  buttons?: AlertButton[];
};

/**
 * Wallet funding outcomes for one store. PiggyVest is enabled only for the
 * PiggyVest merchant (owner, 2026-11-13): there the outcome is the inline
 * wallet notice, bound to the account that started it. Every other merchant
 * keeps exactly today's iOS alert (same title, copy and buttons).
 */
export function walletOutcomeNotifier(merchantId?: string | null) {
  // Loaded only for the PiggyVest merchant: other stores' wallet code stays
  // exactly as light as before (no notice store, no auth-store chain).
  const inline = isPiggyvestPrimaryMerchant(merchantId)
    ? (
        require('../savings/savings-notifier') as typeof import('../savings/savings-notifier')
      ).savingsNotifier()
    : null;
  return (
    notice: { title: string; message?: string; tone?: SavingsNoticeTone },
    legacy: LegacyWalletAlert
  ) => {
    if (inline) inline(notice.title, notice.message, notice.tone);
    // Same call shape as before: buttons only where today's alert had them.
    else if (legacy.buttons)
      Alert.alert(legacy.title, legacy.message, legacy.buttons);
    else Alert.alert(legacy.title, legacy.message);
  };
}
