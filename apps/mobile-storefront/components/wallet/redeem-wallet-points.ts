import { VTU_MIN_REDEEMABLE_POINTS } from '@baci/shared/lib';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { createLogger } from '@/lib/logger';
import { trackError, trackEvent } from '@/services/analytics';
import { scheduleLocalNotification } from '@/services/push-notifications';
import { walletOutcomeNotifier } from './fund/wallet-outcome-notifier';
import { resolveWalletRedeemPointsOutcome } from './wallet-screen.helpers';

const log = createLogger('Wallet');

type RedeemPoints = Parameters<
  typeof resolveWalletRedeemPointsOutcome
>[0]['redeemPoints'];

interface RedeemWalletPointsParams {
  /** The store: only the PiggyVest merchant gets the inline notice. */
  activeMerchantId?: string;
  clearRedeemPoints: () => void;
  closeRedeemPanel: () => void;
  customerId?: string | null;
  rawPoints: string;
  redeemPoints: RedeemPoints;
}

/** Redeems loyalty points; every outcome is the inline wallet notice. */
export async function redeemWalletPoints({
  activeMerchantId,
  clearRedeemPoints,
  closeRedeemPanel,
  customerId,
  rawPoints,
  redeemPoints,
}: RedeemWalletPointsParams): Promise<void> {
  const notify = walletOutcomeNotifier(activeMerchantId);
  const outcome = await resolveWalletRedeemPointsOutcome({
    minimumRedeemablePoints: VTU_MIN_REDEEMABLE_POINTS,
    rawPoints,
    redeemPoints,
  });
  if (outcome.status === 'invalid') {
    notify(
      { title: outcome.title, message: outcome.message, tone: 'warning' },
      { title: outcome.title, message: outcome.message }
    );
    return;
  }
  if (outcome.status === 'error') {
    log.error('Redemption error:', outcome.alertMessage);
    trackError('loyalty_redemption_failed', outcome.telemetryMessage, {
      points_attempted: outcome.points,
      customer_id: customerId,
    });
    notify(
      {
        title: 'Points not redeemed',
        message: outcome.alertMessage,
        tone: 'warning',
      },
      { title: 'Error', message: outcome.alertMessage }
    );
    return;
  }
  trackEvent('loyalty_redeemed', {
    points_redeemed: outcome.points,
    wallet_credit: outcome.result.walletCredit,
    remaining_points: outcome.result.remainingPoints,
    conversion_rate: outcome.result.conversionRate,
    customer_id: customerId,
  });
  await scheduleLocalNotification(
    'Points Redeemed! 🎁',
    outcome.successMessage,
    { type: 'loyalty_redemption', points: outcome.points },
    1
  );
  notify(
    {
      title: 'Points redeemed',
      message: outcome.successMessage,
      tone: 'success',
    },
    {
      title: 'Points Redeemed!',
      message: outcome.successMessage,
      buttons: [{ text: 'OK', onPress: closeRedeemPanel }],
    }
  );
  // The inline notice has no OK button: close the panel now. Other stores
  // keep today's alert, which closes it on OK.
  if (isPiggyvestPrimaryMerchant(activeMerchantId)) closeRedeemPanel();
  clearRedeemPoints();
}
