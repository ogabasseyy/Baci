import 'server-only';
import { piggyvestCreditGapSchemas as schemas } from '@/schemas/piggyvest-credit-gap';
import {
  type ListWalletPage,
  listWalletCreditsSince,
} from './credit-gap-provider-reader';
import type { CreditGapPorts } from './credit-gap-reconciliation';

const LEDGER_STATEMENT =
  'SELECT piggyvest_primary.read_credit_gap_ledger($1::uuid,$2::text,$3::jsonb) AS result';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

/**
 * The credit-gap check's real ports: the read-only ledger function (evidence
 * login, no service role) and PiggyVest's transaction list. The ledger read
 * must be for our business; anything else is handed on unparsed so the check
 * reports it invalid instead of comparing against another business's book.
 */
export function buildCreditGapPorts(input: {
  execute: Execute;
  integrationId: string;
  environment: 'staging' | 'production';
  businessId: string;
  rotationSlot: number;
  listPage: ListWalletPage;
  expired: () => boolean;
}): CreditGapPorts {
  return {
    loadLedger: async () => {
      const { rows } = await input.execute(LEDGER_STATEMENT, [
        input.integrationId,
        input.environment,
        JSON.stringify({ rotationSlot: input.rotationSlot }),
      ]);
      const parsed = schemas.ledgerRows.safeParse(rows);
      return parsed.success &&
        parsed.data[0].result.businessId === input.businessId
        ? parsed.data[0].result
        : { rejected: true };
    },
    listWalletCredits: (walletId, sinceMs) =>
      listWalletCreditsSince({
        walletId,
        sinceMs,
        listPage: input.listPage,
        expired: input.expired,
      }),
    expired: input.expired,
  };
}
