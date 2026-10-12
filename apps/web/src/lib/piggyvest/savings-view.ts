import 'server-only';
import { piggyvestSavingsViewSchemas } from '@/schemas/piggyvest-savings-view';
import { createSavingsLedger } from './savings-ledger';
import { evaluateSavingsPolicy } from './savings-policy';

export async function readPiggyvestSavingsView({
  configuration,
  resolveAuthenticatedGoal,
  execute,
  now = () => new Date(),
}: {
  configuration: unknown;
  resolveAuthenticatedGoal: () => Promise<unknown>;
  execute: Parameters<typeof createSavingsLedger>[1];
  now?: () => Date;
}): Promise<
  | { status: 'unavailable' }
  | {
      status: 'ready';
      decision: ReturnType<typeof evaluateSavingsPolicy>;
      pendingInterestKobo: number;
    }
> {
  try {
    const config =
      piggyvestSavingsViewSchemas.configuration.parse(configuration);
    const goal = piggyvestSavingsViewSchemas.goal.parse(
      await resolveAuthenticatedGoal()
    );
    const identity = goal.identity;
    if (
      identity.integrationId !== config.integrationId ||
      identity.merchantId !== config.merchantId ||
      !config.allowlistedCustomerIds.includes(identity.customerId)
    )
      return { status: 'unavailable' };
    const stored = await createSavingsLedger(identity, execute).snapshot();
    const reservation =
      stored.activeReservation?.kind === 'reserve_purchase'
        ? 'purchase'
        : stored.activeReservation?.kind === 'reserve_refund'
          ? 'cancellation'
          : 'none';
    if (
      (goal.policy.goalState === 'purchase_pending' &&
        reservation !== 'purchase') ||
      (goal.policy.goalState === 'cancellation_pending' &&
        reservation !== 'cancellation')
    )
      return { status: 'unavailable' };
    const decision = evaluateSavingsPolicy({
      ...goal.policy,
      ledger: stored.ledger,
      reservation,
      fundingReversed: stored.fundingReversed,
      now: now().toISOString(),
    });
    return {
      status: 'ready',
      decision,
      pendingInterestKobo: stored.ledger.pendingInterestKobo,
    };
  } catch {
    return { status: 'unavailable' };
  }
}
