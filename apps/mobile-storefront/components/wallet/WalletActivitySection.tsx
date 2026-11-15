import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { PiggyvestWalletActivity } from './activity/PiggyvestWalletActivity';
import { withoutPiggyvestActivityRows } from './activity/without-piggyvest-activity-rows';
import { useWalletPrimaryReady } from './WalletPrimaryContext';
import { WalletTransactionHistory } from './WalletTransactionHistory';
import type { WalletContentProps } from './wallet-content-props.types';

/**
 * Everything under the wallet card: the PiggyVest wallet activity when the
 * PiggyVest wallet is ready (PiggyVest merchant only, owner 2026-11-13),
 * then the older store credit list. Any other store, or PiggyVest off, gets
 * exactly today's list and never asks for PiggyVest activity.
 */
export function WalletActivitySection({
  colors,
  merchantId,
  storeCreditBalance,
  transactions,
  walletUpdatedAt,
}: Pick<
  WalletContentProps,
  | 'colors'
  | 'merchantId'
  | 'storeCreditBalance'
  | 'transactions'
  | 'walletUpdatedAt'
>) {
  const primaryReady = useWalletPrimaryReady();
  const showActivity = primaryReady && isPiggyvestPrimaryMerchant(merchantId);
  return (
    <>
      {showActivity ? (
        <PiggyvestWalletActivity
          colors={colors}
          merchantId={merchantId}
          refreshKey={walletUpdatedAt}
        />
      ) : null}
      <WalletTransactionHistory
        colors={colors}
        storeCreditBalance={storeCreditBalance}
        transactions={
          showActivity
            ? withoutPiggyvestActivityRows(transactions)
            : transactions
        }
      />
    </>
  );
}
