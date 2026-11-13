import { VTU_MIN_REDEEMABLE_POINTS } from '@baci/shared/lib';
import { createLogger } from '@/lib/logger';
import { trackError, trackEvent } from '@/services/analytics';
import { scheduleLocalNotification } from '@/services/push-notifications';
import { savingsNotifier } from './savings/savings-notifier';
import { resolveWalletRedeemPointsOutcome } from './wallet-screen.helpers';

const log = createLogger('Wallet');

type RedeemPoints = Parameters<
  typeof resolveWalletRedeemPointsOutcome
>[0]['redeemPoints'];

interface RedeemWalletPointsParams {
  clearRedeemPoints: () => void;
  closeRedeemPanel: () => void;
  customerId?: string | null;
  rawPoints: string;
  redeemPoints: RedeemPoints;
}

/** Redeems loyalty points; every outcome is the inline wallet notice. */
export async function redeemWalletPoints({
  clearRedeemPoints,
  closeRedeemPanel,
  customerId,
  rawPoints,
  redeemPoints,
}: RedeemWalletPointsParams): Promise<void> {
  const notify = savingsNotifier();
  const outcome = await resolveWalletRedeemPointsOutcome({
    minimumRedeemablePoints: VTU_MIN_REDEEMABLE_POINTS,
    rawPoints,
    redeemPoints,
  });
  if (outcome.status === 'invalid') {
    notify(outcome.title, outcome.message, 'warning');
    return;
  }
  if (outcome.status === 'error') {
    log.error('Redemption error:', outcome.alertMessage);
    trackError('loyalty_redemption_failed', outcome.telemetryMessage, {
      points_attempted: outcome.points,
      customer_id: customerId,
    });
    notify('Points not redeemed', outcome.alertMessage, 'warning');
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
  notify('Points redeemed', outcome.successMessage, 'success');
  closeRedeemPanel();
  clearRedeemPoints();
}
