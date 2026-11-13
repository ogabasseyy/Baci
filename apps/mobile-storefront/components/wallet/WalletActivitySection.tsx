import { PiggyvestWalletActivity } from './activity/PiggyvestWalletActivity';
import type { WalletContentProps } from './WalletContent';
import { useWalletPrimaryReady } from './WalletPrimaryContext';
import { WalletTransactionHistory } from './WalletTransactionHistory';

/**
 * Everything under the wallet card: the PiggyVest wallet activity when the
 * PiggyVest wallet is ready, then the older store credit list. With
 * PiggyVest off this is exactly today's "Recent Transactions".
 */
export function WalletActivitySection({
  colors,
  merchantId,
  transactions,
  walletUpdatedAt,
}: Pick<
  WalletContentProps,
  'colors' | 'merchantId' | 'transactions' | 'walletUpdatedAt'
>) {
  const primaryReady = useWalletPrimaryReady();
  return (
    <>
      {primaryReady ? (
        <PiggyvestWalletActivity
          colors={colors}
          merchantId={merchantId}
          refreshKey={walletUpdatedAt}
        />
      ) : null}
      <WalletTransactionHistory colors={colors} transactions={transactions} />
    </>
  );
}
