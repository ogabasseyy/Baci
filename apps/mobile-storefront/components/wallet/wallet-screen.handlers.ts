import { isHostedStagingWalletTopUpBlocked } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { rollbackObservedCapabilityOnNotReady } from '@/lib/piggyvest-primary-capability';
import { walletOutcomeNotifier } from './fund/wallet-outcome-notifier';
import {
  fundPrimaryWalletCard,
  NOTHING_TO_RECOVER,
} from './fund-primary-wallet-card';
import { resolveFundWalletRail } from './resolve-fund-wallet-rail';
import { runExclusiveWalletFunding } from './run-exclusive-wallet-funding';
import { startLegacyWalletTopUp } from './start-legacy-wallet-top-up';

interface WalletHandlerCustomer {
  email?: string | null;
  first_name?: string | null;
  id?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

interface WalletHandlerUser {
  email?: string | null;
  id?: string | null;
}

interface FundWalletParams {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  customer?: WalletHandlerCustomer | null;
  fundAmount: string;
  refetchWalletBalance?: () => Promise<unknown>;
  resetFundPanel: () => void;
  setIsFundPending: (isPending: boolean) => void;
  user?: WalletHandlerUser | null;
  walletReturnTo?: string;
}

// Account creation and points redemption live in their own modules;
// re-exported for existing callers.
export { createWalletFundingAccount } from './create-wallet-funding-account';
export { redeemWalletPoints } from './redeem-wallet-points';

export function fundWallet(params: FundWalletParams): Promise<void> {
  const scope = `${params.activeMerchantId ?? ''}:${params.user?.id ?? ''}`;
  return runExclusiveWalletFunding(scope, () => fundWalletOnce(params));
}

async function fundWalletOnce({
  activeMerchantId,
  activeMerchantSlug,
  customer,
  fundAmount,
  refetchWalletBalance,
  resetFundPanel,
  setIsFundPending,
  user,
  walletReturnTo,
}: FundWalletParams): Promise<void> {
  const notify = walletOutcomeNotifier(activeMerchantId);
  if (isHostedStagingWalletTopUpBlocked()) {
    notify(
      {
        title: 'Wallet top-up unavailable',
        message:
          'Card wallet top-ups are disabled in this hosted staging preview.',
        tone: 'warning',
      },
      {
        title: 'Wallet top-up unavailable',
        message:
          'Card wallet top-ups are disabled in this hosted staging preview.',
      }
    );
    return;
  }
  // A failed probe blocks with a retry that re-runs funding with these params.
  const rail = await resolveFundWalletRail(activeMerchantId, {
    userId: user?.id ?? undefined,
    walletReturnTo,
    onRetry: () =>
      void fundWallet({
        activeMerchantId,
        activeMerchantSlug,
        customer,
        fundAmount,
        refetchWalletBalance,
        resetFundPanel,
        setIsFundPending,
        user,
        walletReturnTo,
      }),
  });
  if (rail === 'blocked') return;
  if (rail === 'primary') {
    // Recovery before amount validation: a saved (maybe charged) funding is
    // rechecked even with an empty amount; new fundings validate inside.
    try {
      const outcome = await fundPrimaryWalletCard({
        activeMerchantId,
        activeMerchantSlug,
        customer,
        fundAmount,
        refetchWalletBalance,
        resetFundPanel,
        setIsFundPending,
        user,
        walletReturnTo,
      });
      if (outcome !== NOTHING_TO_RECOVER) return;
    } catch (error) {
      // Primary unconfigured on the server: fall through to legacy below.
      if (!rollbackObservedCapabilityOnNotReady(activeMerchantId, error))
        throw error;
    }
  }
  await startLegacyWalletTopUp({
    activeMerchantId,
    activeMerchantSlug,
    customer,
    fundAmount,
    resetFundPanel,
    setIsFundPending,
    user,
    walletReturnTo,
    notify,
  });
}
