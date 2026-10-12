import { describe, expect, it, vi } from 'vitest';
import { createTransferOutboxSubmissionWriter } from './transfer-outbox-submission';
import { PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS } from './transfer-outbox-submission-statements';

const command = {
  authorizationId: 'a0065070-dc32-45d2-9c01-871a27abfd10',
  reference: 'submission-001',
  customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  merchantId: '43e157b6-179c-432a-9392-e0827da96d82',
  walletId: 'ledger-wallet-001',
  amountKobo: 500_000,
  currency: 'NGN' as const,
  sourceWalletId: 'source-wallet-001',
  destinationRef: '058:6789',
  direction: 'bank' as const,
  providerCustomerId: 'provider-customer-001',
  businessId: 'business-001',
  integrationId: 'integration-001',
};

function writerWith(outcomes: Array<string | undefined>) {
  const execute = vi.fn(
    async (statement: string, parameters: readonly unknown[]) => {
      const placeholders = [...statement.matchAll(/\$(\d+)::/g)].map((match) =>
        Number(match[1])
      );
      expect(parameters).toHaveLength(Math.max(...placeholders));
      const outcome = outcomes.shift();
      if (
        statement === PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.claim.text ||
        statement ===
          PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.recordAccepted.text ||
        statement === PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.markUnknown.text ||
        statement === PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.recoverUnknown.text
      ) {
        return { rows: [{ outcome }] };
      }
      throw new Error('unexpected SQL statement');
    }
  );
  return {
    execute,
    writer: createTransferOutboxSubmissionWriter({
      execute,
      expectedSystemId: '123456789',
      businessId: 'business-001',
      integrationId: 'integration-001',
    }),
  };
}

describe('transfer outbox submission writer', () => {
  it('claims the complete identity before the provider submission', async () => {
    const { execute, writer } = writerWith(['claimed', 'submitted']);
    const send = vi.fn(async () => undefined);

    await expect(writer.submit({ command, send })).resolves.toEqual({
      outcome: 'submitted',
    });
    expect(send).toHaveBeenCalledExactlyOnceWith(command);
    expect(execute.mock.calls.map(([statement]) => statement)).toEqual([
      PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.claim.text,
      PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.recordAccepted.text,
    ]);
    expect(execute).toHaveBeenNthCalledWith(
      1,
      PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.claim.text,
      [
        '123456789',
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
      ]
    );
  });

  it('does not resend when a restart finds a pre-send claim', async () => {
    const { writer } = writerWith(['already-claimed']);
    const send = vi.fn(async () => undefined);

    await expect(writer.submit({ command, send })).resolves.toEqual({
      outcome: 'already-claimed',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('marks an unknown provider outcome and refuses a fresh retry', async () => {
    const { execute, writer } = writerWith(['claimed', 'outcome-unknown']);
    const send = vi.fn(async () => {
      throw new Error('synthetic timeout with an untrusted response body');
    });

    await expect(writer.submit({ command, send })).resolves.toEqual({
      outcome: 'outcome-unknown',
    });
    expect(send).toHaveBeenCalledOnce();
    expect(execute.mock.calls.map(([statement]) => statement)).toEqual([
      PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.claim.text,
      PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.markUnknown.text,
    ]);
  });

  it('marks accepted-but-unrecorded submissions unknown instead of retrying', async () => {
    const { execute, writer } = writerWith([
      'claimed',
      undefined,
      'outcome-unknown',
    ]);
    const send = vi.fn(async () => undefined);

    await expect(writer.submit({ command, send })).resolves.toEqual({
      outcome: 'outcome-unknown',
    });
    expect(send).toHaveBeenCalledOnce();
    expect(execute.mock.calls.map(([statement]) => statement)).toEqual([
      PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.claim.text,
      PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.recordAccepted.text,
      PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.markUnknown.text,
    ]);
  });

  it('recovers a crashed submission only from complete terminal evidence', async () => {
    const { execute, writer } = writerWith(['applied']);

    await expect(
      writer.recoverUnknown({
        command,
        evidence: {
          reference: 'submission-001',
          amountKobo: 500_000,
          currency: 'NGN',
          sourceWalletId: 'source-wallet-001',
          destinationWalletId: '058:6789',
          direction: 'bank',
          providerCustomerId: 'provider-customer-001',
          businessId: 'business-001',
          integrationId: 'integration-001',
          providerTransactionId: 'provider-transaction-001',
        },
        terminalStatus: 'succeeded',
      })
    ).resolves.toEqual({ outcome: 'applied' });
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      PIGGYVEST_OUTBOX_SUBMISSION_STATEMENTS.recoverUnknown.text,
      expect.arrayContaining([
        'a0065070-dc32-45d2-9c01-871a27abfd10',
        'provider-transaction-001',
        'succeeded',
      ])
    );
  });
});
