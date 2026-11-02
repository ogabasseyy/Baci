import 'server-only';
import {
  type HouseWalletRole,
  type HouseWalletRow,
  houseWalletIntegrationIdSchema,
  houseWalletRowsSchema,
} from '@/schemas/piggyvest/house-wallets';

/**
 * Reads Ogabassey's house wallets (Collection, Interest, Fee) for one
 * PiggyVest integration through piggyvest_primary.read_house_wallets.
 *
 * Fails closed: a wallet counts only when it is enabled and verified, the
 * registry is ready only when all three are, and any response that breaks
 * the registry's own rules (two rows for a role, one wallet id for two
 * roles, two businesses) or any query failure is reported as unavailable.
 * The caller supplies the query function of a dedicated engine login; the
 * database answers only a login registered for that integration, so any
 * other login reads as unavailable.
 */
export const HOUSE_WALLET_ROLES = [
  'collection',
  'interest',
  'fee',
] as const satisfies readonly HouseWalletRole[];

export interface HouseWallet {
  role: HouseWalletRole;
  providerWalletId: string;
  businessId: string;
  currency: 'NGN';
}

export type HouseWalletRegistry =
  | {
      status: 'ready';
      businessId: string;
      wallets: Readonly<Record<HouseWalletRole, HouseWallet>>;
    }
  | {
      status: 'incomplete';
      missing: HouseWalletRole[];
      wallets: Readonly<Partial<Record<HouseWalletRole, HouseWallet>>>;
    }
  | { status: 'unavailable'; reason: 'query_failed' | 'invalid_response' };

export type HouseWalletQuery = (
  text: string,
  values: readonly unknown[]
) => Promise<{ rows: readonly unknown[] }>;

const READ_HOUSE_WALLETS =
  'SELECT role, provider_wallet_id, business_id, currency, enabled, verified FROM piggyvest_primary.read_house_wallets($1::uuid)';

function isConsistent(rows: readonly HouseWalletRow[]): boolean {
  const roles = new Set(rows.map((row) => row.role));
  const walletIds = new Set(rows.map((row) => row.provider_wallet_id));
  const businesses = new Set(rows.map((row) => row.business_id));
  return (
    roles.size === rows.length &&
    walletIds.size === rows.length &&
    businesses.size <= 1
  );
}

export function resolveHouseWallets(
  rows: readonly unknown[]
): HouseWalletRegistry {
  const parsed = houseWalletRowsSchema.safeParse(rows);
  if (!parsed.success || !isConsistent(parsed.data)) {
    return { status: 'unavailable', reason: 'invalid_response' };
  }
  const wallets: Partial<Record<HouseWalletRole, HouseWallet>> = {};
  for (const row of parsed.data) {
    if (row.enabled && row.verified) {
      wallets[row.role] = {
        role: row.role,
        providerWalletId: row.provider_wallet_id,
        businessId: row.business_id,
        currency: row.currency,
      };
    }
  }
  const missing = HOUSE_WALLET_ROLES.filter((role) => !wallets[role]);
  const { collection, interest, fee } = wallets;
  if (missing.length > 0 || !collection || !interest || !fee) {
    return { status: 'incomplete', missing, wallets };
  }
  return {
    status: 'ready',
    businessId: collection.businessId,
    wallets: { collection, interest, fee },
  };
}

export async function readHouseWallets(
  query: HouseWalletQuery,
  integrationId: string
): Promise<HouseWalletRegistry> {
  const id = houseWalletIntegrationIdSchema.parse(integrationId);
  let rows: readonly unknown[];
  try {
    ({ rows } = await query(READ_HOUSE_WALLETS, [id]));
  } catch {
    return { status: 'unavailable', reason: 'query_failed' };
  }
  return resolveHouseWallets(rows);
}
