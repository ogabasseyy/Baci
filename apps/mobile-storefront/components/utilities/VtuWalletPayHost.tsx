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
  return <WalletPaySheet colors={colors} {...host.sheetProps} />;
}
