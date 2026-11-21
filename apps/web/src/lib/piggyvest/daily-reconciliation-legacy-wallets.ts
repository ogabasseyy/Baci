import 'server-only';
import {
  type PiggyvestLegacyMigratedWallets,
  piggyvestLegacyMigratedWalletRowsSchema,
} from '@/schemas/piggyvest-legacy-migrated-wallets';
import { LEGACY_MIGRATED_WALLET_STATEMENTS as sql } from './legacy-migrated-wallet-statements';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

/**
 * Old in-app wallets already moved to PiggyVest by hand (S10 runbook) that
 * hold money again, for example after a late refund. Read-only (evidence
 * login), scoped to the integration's own merchant, and it never moves money.
 * An unreadable answer throws so the run is never reported as all clear.
 */
export async function readMigratedLegacyWallets(input: {
  execute: Execute;
  integrationId: string;
  environment: string;
}): Promise<PiggyvestLegacyMigratedWallets> {
  const { rows } = await input.execute(sql.readBalances, [
    input.integrationId,
    input.environment,
    '{}',
  ]);
  return piggyvestLegacyMigratedWalletRowsSchema.parse(rows)[0].result;
}
