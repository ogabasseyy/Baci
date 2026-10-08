import type z from 'zod';
import { transferOutboxFinalitySchemas } from './schemas/transfer-outbox-finality';
import { terminalReconciliationInputSchema } from './schemas/transfer-reconciliation';
import { PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS } from './transfer-outbox-finality-statements';
import type {
  AtomicTerminalWriter,
  ExpectedOutflowOperation,
  TerminalEvidence,
} from './transfer-reconciliation';

export type DirectPostgresExecutor = (
  text: string,
  values: readonly unknown[]
) => Promise<{ rows: unknown[] }>;

export type ScopedOutflowLookup = Pick<
  TerminalEvidence,
  'reference' | 'providerCustomerId'
>;

export type ScopedExpectedOutflowOperation = ExpectedOutflowOperation & {
  customerId: string;
};

export type DurableOutflowStore = AtomicTerminalWriter & {
  findExpected: (
    input: ScopedOutflowLookup
  ) => Promise<ScopedExpectedOutflowOperation | null>;
};

function expectedOperationFromRow(
  row: unknown,
  scope: ScopedOutflowLookup,
  config: z.infer<typeof transferOutboxFinalitySchemas.storeConfig>
): ScopedExpectedOutflowOperation {
  const parsed = transferOutboxFinalitySchemas.expectedRow.safeParse(row);
  if (!parsed.success) {
    throw new Error(
      'Outgoing transfer finality lookup returned an invalid row'
    );
  }
  if (
    parsed.data.reference !== scope.reference ||
    parsed.data.provider_customer_id !== scope.providerCustomerId ||
    parsed.data.business_id !== config.businessId ||
    parsed.data.integration_id !== config.integrationId
  ) {
    throw new Error(
      'Outgoing transfer finality lookup returned a mismatched row'
    );
  }
  return {
    customerId: parsed.data.customer_id,
    reference: parsed.data.reference,
    amountKobo: parsed.data.amount_kobo,
    currency: parsed.data.currency,
    sourceWalletId: parsed.data.source_wallet_id,
    destinationWalletId: parsed.data.destination_ref,
    direction: parsed.data.direction,
    providerCustomerId: parsed.data.provider_customer_id,
    businessId: parsed.data.business_id,
    integrationId: parsed.data.integration_id,
    status: parsed.data.status,
  };
}

function evidenceMatchesExpected(
  expected: ExpectedOutflowOperation,
  evidence: TerminalEvidence
): boolean {
  return (
    evidence.reference === expected.reference &&
    evidence.amountKobo === expected.amountKobo &&
    evidence.currency === expected.currency &&
    evidence.sourceWalletId === expected.sourceWalletId &&
    evidence.destinationWalletId === expected.destinationWalletId &&
    evidence.direction === expected.direction &&
    evidence.providerCustomerId === expected.providerCustomerId &&
    evidence.businessId === expected.businessId &&
    evidence.integrationId === expected.integrationId
  );
}

export function createDurableOutflowStore(configInput: {
  execute: DirectPostgresExecutor;
  expectedSystemId: string;
  businessId: string;
  integrationId: string;
}): DurableOutflowStore {
  const config = transferOutboxFinalitySchemas.storeConfig.parse(configInput);
  return {
    async findExpected(scope) {
      const parsedScope = transferOutboxFinalitySchemas.lookup.parse(scope);
      const result = await configInput.execute(
        PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS.readExpected.text,
        [
          config.expectedSystemId,
          parsedScope.reference,
          parsedScope.providerCustomerId,
          config.businessId,
          config.integrationId,
        ]
      );
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) {
        throw new Error(
          'Outgoing transfer finality lookup returned multiple rows'
        );
      }
      return expectedOperationFromRow(result.rows[0], parsedScope, config);
    },

    async compareAndSetTerminal(input) {
      const parsedInput = terminalReconciliationInputSchema.safeParse(input);
      if (!parsedInput.success) {
        throw new Error('Outgoing transfer finality compare-and-set failed');
      }
      const { expected, evidence, terminalStatus } = parsedInput.data;
      if (!evidenceMatchesExpected(expected, evidence)) {
        throw new Error(
          'Outgoing transfer finality evidence did not match expected operation'
        );
      }
      if (
        expected.businessId !== config.businessId ||
        evidence.businessId !== config.businessId ||
        expected.integrationId !== config.integrationId ||
        evidence.integrationId !== config.integrationId
      ) {
        throw new Error('Outgoing transfer finality scope did not match store');
      }
      const result = await configInput.execute(
        PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS.compareAndSet.text,
        [
          config.expectedSystemId,
          expected.reference,
          expected.amountKobo,
          expected.currency,
          expected.sourceWalletId,
          expected.destinationWalletId,
          expected.direction,
          expected.providerCustomerId,
          expected.businessId,
          expected.integrationId,
          evidence.providerTransactionId,
          terminalStatus,
        ]
      );
      if (result.rows.length !== 1) {
        throw new Error('Outgoing transfer finality compare-and-set failed');
      }
      const outcomeRow =
        transferOutboxFinalitySchemas.terminalOutcomeRow.safeParse(
          result.rows[0]
        );
      if (!outcomeRow.success) {
        throw new Error('Outgoing transfer finality compare-and-set failed');
      }
      return outcomeRow.data.outcome;
    },
  };
}
