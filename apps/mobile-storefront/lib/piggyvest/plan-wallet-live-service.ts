import type {
  PlanWalletService,
  PlanWalletSnapshot,
} from '@/lib/piggyvest/plan-wallet-service';
import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';
import { PlanWalletSnapshotSchema } from '@/schemas/piggyvest-plan-wallet';

const PLAN_WALLET_PATH = '/api/storefront/customer/wallet/piggyvest-plan';

export type LivePlanWalletServiceOptions = {
  merchantId?: string | null;
  merchantSlug?: string | null;
};

function parseSnapshot(data: unknown, operation: string): PlanWalletSnapshot {
  const parsed = PlanWalletSnapshotSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Invalid plan wallet ${operation} response: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

/**
 * Live PlanWalletService backed by the storefront API routes (which call
 * PiggyVest staging behind the synthetic-KYC gate). Inject into
 * PlanWalletSection via the `service` prop once the staging backend is
 * reachable from the app; the section defaults to the fixture service so a
 * dev build can never accidentally hit the production API base.
 */
export function createLivePlanWalletService({
  merchantId,
  merchantSlug,
}: LivePlanWalletServiceOptions): PlanWalletService {
  const client = createStorefrontCustomerApiClient();

  const load = async (): Promise<PlanWalletSnapshot> => {
    const data = await client.fetchJson({
      path: PLAN_WALLET_PATH,
      query: { merchantId, merchantSlug },
    });
    return parseSnapshot(data, 'snapshot');
  };

  return {
    getSnapshot: load,
    refresh: load,
    createWallet: async (): Promise<PlanWalletSnapshot> => {
      const data = await client.fetchJson({
        body: {
          ...client.buildMerchantIdentifiers({ merchantId, merchantSlug }),
        },
        method: 'POST',
        path: PLAN_WALLET_PATH,
      });
      return parseSnapshot(data, 'create');
    },
  };
}
