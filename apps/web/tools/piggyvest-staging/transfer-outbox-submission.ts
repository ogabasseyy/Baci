import { transferOutboxSubmissionSchemas } from './schemas/transfer-outbox-submission';
import {
  terminalEvidenceSchema,
  terminalStatusSchema,
} from './schemas/transfer-reconciliation';
import { PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS } from './transfer-outbox-submission-statements';
import type { createTransferSubmissionPostgres } from './transfer-submission-postgres';

export class TransferOutboxSubmissionError extends Error {
  constructor() {
    super('PiggyVest transfer submission persistence failed');
    this.name = 'TransferOutboxSubmissionError';
  }
}

type SubmissionCommand = ReturnType<
  typeof transferOutboxSubmissionSchemas.command.parse
>;

type TransferOutboxSubmissionExecutor = ReturnType<
  typeof createTransferSubmissionPostgres
>;

type SubmissionOutcome =
  | { outcome: 'submitted' }
  | { outcome: 'already-claimed' }
  | { outcome: 'already-submitted' }
  | { outcome: 'outcome-unknown' }
  | { outcome: 'identity-conflict' };

function values(expectedSystemId: string, command: SubmissionCommand) {
  return [
    expectedSystemId,
    command.authorizationId,
    command.reference,
    command.customerId,
    command.merchantId,
    command.walletId,
    command.amountKobo,
    command.currency,
    command.sourceWalletId,
    command.destinationRef,
    command.direction,
    command.providerCustomerId,
    command.businessId,
    command.integrationId,
  ] as const;
}

export function createTransferOutboxSubmissionWriter(configInput: {
  execute: TransferOutboxSubmissionExecutor;
  expectedSystemId: string;
  businessId: string;
  integrationId: string;
}) {
  const config = transferOutboxSubmissionSchemas.storeConfig.parse(configInput);

  async function executeOutcome(
    statement: { text: string; parameters: number },
    command: SubmissionCommand
  ) {
    const statementValues = values(config.expectedSystemId, command);
    if (statementValues.length !== statement.parameters) {
      throw new TransferOutboxSubmissionError();
    }
    const result = await configInput.execute(statement.text, statementValues);
    if (result.rows.length !== 1) throw new TransferOutboxSubmissionError();
    const row = transferOutboxSubmissionSchemas.outcomeRow.safeParse(
      result.rows[0]
    );
    if (!row.success) throw new TransferOutboxSubmissionError();
    return row.data.outcome;
  }

  return {
    async submit(input: {
      command: unknown;
      send: (command: SubmissionCommand) => Promise<void>;
    }): Promise<SubmissionOutcome> {
      const command = transferOutboxSubmissionSchemas.command.parse(
        input.command
      );
      if (
        command.businessId !== config.businessId ||
        command.integrationId !== config.integrationId
      ) {
        throw new TransferOutboxSubmissionError();
      }
      if (typeof input.send !== 'function')
        throw new TransferOutboxSubmissionError();

      const claim = transferOutboxSubmissionSchemas.claimOutcome.parse(
        await executeOutcome(
          PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.claim,
          command
        )
      );
      if (claim !== 'claimed') return { outcome: claim };

      try {
        await input.send(command);
      } catch {
        const outcome =
          transferOutboxSubmissionSchemas.markUnknownOutcome.parse(
            await executeOutcome(
              PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.markUnknown,
              command
            )
          );
        if (outcome === 'outcome-unknown') return { outcome };
        throw new TransferOutboxSubmissionError();
      }

      const accepted = await executeOutcome(
        PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.recordAccepted,
        command
      )
        .then((outcome) =>
          transferOutboxSubmissionSchemas.recordAcceptedOutcome.parse(outcome)
        )
        .catch(() => null);
      if (accepted === 'submitted' || accepted === 'already-submitted') {
        return { outcome: accepted };
      }

      const outcome = transferOutboxSubmissionSchemas.markUnknownOutcome.parse(
        await executeOutcome(
          PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.markUnknown,
          command
        )
      );
      if (outcome === 'outcome-unknown') return { outcome };
      throw new TransferOutboxSubmissionError();
    },

    async recoverUnknown(input: {
      command: unknown;
      evidence: unknown;
      terminalStatus: unknown;
    }) {
      const command = transferOutboxSubmissionSchemas.command.parse(
        input.command
      );
      const evidence = terminalEvidenceSchema.parse(input.evidence);
      const terminalStatus = terminalStatusSchema.parse(input.terminalStatus);
      if (
        command.businessId !== config.businessId ||
        command.integrationId !== config.integrationId ||
        evidence.reference !== command.reference ||
        evidence.amountKobo !== command.amountKobo ||
        evidence.currency !== command.currency ||
        evidence.sourceWalletId !== command.sourceWalletId ||
        evidence.destinationWalletId !== command.destinationRef ||
        evidence.direction !== command.direction ||
        evidence.providerCustomerId !== command.providerCustomerId ||
        evidence.businessId !== command.businessId ||
        evidence.integrationId !== command.integrationId
      ) {
        throw new TransferOutboxSubmissionError();
      }
      const statementValues = [
        ...values(config.expectedSystemId, command),
        evidence.providerTransactionId,
        terminalStatus,
      ] as const;
      if (
        statementValues.length !==
        PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.recoverUnknown.parameters
      ) {
        throw new TransferOutboxSubmissionError();
      }
      const result = await configInput.execute(
        PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.recoverUnknown.text,
        statementValues
      );
      if (result.rows.length !== 1) throw new TransferOutboxSubmissionError();
      const row = transferOutboxSubmissionSchemas.outcomeRow.safeParse(
        result.rows[0]
      );
      if (!row.success) throw new TransferOutboxSubmissionError();
      return {
        outcome: transferOutboxSubmissionSchemas.recoveryOutcome.parse(
          row.data.outcome
        ),
      };
    },
  };
}
