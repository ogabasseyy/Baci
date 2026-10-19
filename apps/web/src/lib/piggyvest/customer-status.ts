import 'server-only';
import type { CustomerSavingsStatusProps } from '@/components/storefront/piggyvest-savings/customer-savings-status.types';
import { piggyvestCustomerStatusSchema } from '@/schemas/piggyvest-customer-status';
import { readPiggyvestSavingsView } from './savings-view';

type ReadyStatus = Omit<
  Extract<CustomerSavingsStatusProps, { status: 'ready' }>,
  'onReviewPurchase' | 'actionPending'
>;

export async function readPiggyvestCustomerStatus({
  configuration,
  resolveAuthenticatedGoal,
  execute,
  now,
}: {
  configuration: unknown;
  resolveAuthenticatedGoal: () => Promise<unknown>;
  execute: Parameters<typeof readPiggyvestSavingsView>[0]['execute'];
  now?: () => Date;
}): Promise<ReadyStatus | { status: 'unavailable' }> {
  try {
    const resolved = piggyvestCustomerStatusSchema.parse(
      await resolveAuthenticatedGoal()
    );
    const view = await readPiggyvestSavingsView({
      configuration,
      resolveAuthenticatedGoal: async () => resolved.goal,
      execute,
      now,
    });
    if (view.status !== 'ready') return { status: 'unavailable' };
    return {
      status: 'ready',
      device: resolved.device,
      pendingInterestKobo: view.pendingInterestKobo,
      decision: {
        purchasingPowerKobo: view.decision.purchasingPowerKobo,
        devicePriceKobo: view.decision.devicePriceKobo,
        readiness: view.decision.readiness,
        purchaseAction: view.decision.purchaseAction,
      },
    };
  } catch {
    return { status: 'unavailable' };
  }
}
