import { queryTransactionStatus } from '../../src/lib/piggyvest/transfers';
import {
  scopedExpectedOutflowOperationSchema,
  transactionStatusNormalizedTerminalSchema,
  transactionStatusResultSchema,
  transactionStatusRunnerConfigSchema,
} from './schemas/transfer-reconciliation';
import {
  type AtomicTerminalWriter,
  type ExpectedOutflowOperation,
  reconcileVerifiedOutflowTerminal,
} from './transfer-reconciliation';

export interface TransactionStatusReader {
  query: (input: { reference: string; walletId: string }) => Promise<unknown>;
}

export interface TransactionStatusOutboxStore extends AtomicTerminalWriter {
  findExpected: (input: {
    reference: string;
    providerCustomerId: string;
  }) => Promise<unknown>;
}

type TransactionStatusOutcome =
  | { outcome: 'pending' }
  | { outcome: 'unknown' }
  | {
      outcome: 'unresolved';
      reason: 'reference-mismatch' | 'amount-mismatch' | 'tsq-missing-identity';
    };

function reconcileTransactionStatusResponse(
  expected: ExpectedOutflowOperation,
  response: unknown
): TransactionStatusOutcome {
  const result = transactionStatusResultSchema.safeParse(response);
  if (!result.success) return { outcome: 'unknown' };
  if (result.data.reference !== expected.reference) {
    return { outcome: 'unresolved', reason: 'reference-mismatch' };
  }
  if (result.data.amount !== expected.amountKobo) {
    return { outcome: 'unresolved', reason: 'amount-mismatch' };
  }
  if (result.data.status === 'pending') return { outcome: 'pending' };
  return { outcome: 'unresolved', reason: 'tsq-missing-identity' };
}

function normalizeTransactionStatusTerminal(
  expected: ExpectedOutflowOperation,
  customerId: string,
  response: unknown
) {
  const terminal =
    transactionStatusNormalizedTerminalSchema.safeParse(response);
  if (!terminal.success || terminal.data.status === 'pending') return null;
  const data = terminal.data;
  if (
    data.reference !== expected.reference ||
    data.customerId !== customerId ||
    data.amount !== expected.amountKobo ||
    data.currency !== expected.currency ||
    data.sourceWalletId !== expected.sourceWalletId ||
    data.destinationWalletId !== expected.destinationWalletId ||
    data.direction !== expected.direction ||
    data.providerCustomerId !== expected.providerCustomerId ||
    data.businessId !== expected.businessId ||
    data.integrationId !== expected.integrationId
  ) {
    return null;
  }
  return {
    expected,
    evidence: {
      reference: data.reference,
      amountKobo: data.amount,
      currency: data.currency,
      sourceWalletId: data.sourceWalletId,
      destinationWalletId: data.destinationWalletId,
      direction: data.direction,
      providerCustomerId: data.providerCustomerId,
      businessId: data.businessId,
      integrationId: data.integrationId,
      providerTransactionId: data.providerTransactionId,
    },
    terminalStatus:
      data.status === 'success' ? ('succeeded' as const) : ('failed' as const),
  };
}

export function createConfiguredTransactionStatusRunner(input: {
  expectedSystemId: string;
  businessId: string;
  integrationId: string;
  query?: TransactionStatusReader['query'];
  stagingConfig: unknown;
}) {
  const config = transactionStatusRunnerConfigSchema.parse({
    expectedSystemId: input.expectedSystemId,
    businessId: input.businessId,
    integrationId: input.integrationId,
    stagingConfig: input.stagingConfig,
  });
  if (
    config.stagingConfig.expectedCurrency !== 'NGN' ||
    config.stagingConfig.expectedBusinessId !== config.businessId
  ) {
    throw new Error('PiggyVest staging TSQ is not configured');
  }
  const query =
    input.query ??
    ((queryInput) =>
      queryTransactionStatus(
        {
          token: config.stagingConfig.apiSecret,
          baseUrl: config.stagingConfig.apiBaseUrl,
        },
        queryInput
      ));

  return {
    async reconcile(reconciliationInput: {
      findExpected: TransactionStatusOutboxStore['findExpected'];
      compareAndSetTerminal: TransactionStatusOutboxStore['compareAndSetTerminal'];
      reference: string;
      customerId: string;
      providerCustomerId: string;
    }) {
      const found = await reconciliationInput.findExpected({
        reference: reconciliationInput.reference,
        providerCustomerId: reconciliationInput.providerCustomerId,
      });
      const scoped = scopedExpectedOutflowOperationSchema.safeParse(found);
      if (
        !scoped.success ||
        scoped.data.reference !== reconciliationInput.reference ||
        scoped.data.customerId !== reconciliationInput.customerId ||
        scoped.data.providerCustomerId !==
          reconciliationInput.providerCustomerId ||
        scoped.data.status !== 'submitted' ||
        scoped.data.businessId !== config.businessId ||
        scoped.data.integrationId !== config.integrationId
      ) {
        return {
          outcome: 'unresolved' as const,
          reason: 'outbox-not-submitted' as const,
        };
      }
      const { customerId: _customerId, ...expected } = scoped.data;
      let response: unknown;
      try {
        response = await query({
          reference: expected.reference,
          walletId: expected.sourceWalletId,
        });
      } catch {
        return { outcome: 'unknown' as const };
      }
      const advisory = reconcileTransactionStatusResponse(expected, response);
      const terminal = normalizeTransactionStatusTerminal(
        expected,
        scoped.data.customerId,
        response
      );
      if (!terminal) return advisory;
      return reconcileVerifiedOutflowTerminal(terminal, reconciliationInput);
    },
  };
}

export async function reconcileTransactionStatus(
  input: { expected: ExpectedOutflowOperation } & TransactionStatusReader
): Promise<TransactionStatusOutcome> {
  try {
    const response = await input.query({
      reference: input.expected.reference,
      walletId: input.expected.sourceWalletId,
    });
    return reconcileTransactionStatusResponse(input.expected, response);
  } catch {
    return { outcome: 'unknown' };
  }
}
