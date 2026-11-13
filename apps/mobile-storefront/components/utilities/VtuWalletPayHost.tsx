import { usePreventRemove } from 'expo-router/react-navigation';
import { WalletPaySheet } from '@/components/wallet-pay/WalletPaySheet';
import type Colors from '@/constants/Colors';
import { useVtuWalletPayHost } from './use-vtu-wallet-pay-host';

type WalletColors = (typeof Colors)['light'];

/** The utilities screen's PiggyVest pay sheet (renders nothing while off). */
export function VtuWalletPayHost({
  colors,
  canPay,
}: {
  colors: WalletColors;
  canPay?: boolean;
}) {
  const host = useVtuWalletPayHost(canPay === undefined ? {} : { canPay });
  // While the sheet is open, leaving the screen (a back gesture or another
  // navigation) goes back through the sheet instead, so an issued payment is
  // released and a payment being sent is never abandoned (Codex P2).
  usePreventRemove(host.sheet.step !== 'closed', () => host.sheet.back());
  return <WalletPaySheet colors={colors} {...host.sheetProps} />;
}
