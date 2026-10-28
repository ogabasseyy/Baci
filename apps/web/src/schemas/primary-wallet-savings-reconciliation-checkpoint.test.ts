import { describe, expect, it } from 'vitest';
import { primaryWalletSavingsReconciliationCheckpointSchemas as schemas } from './primary-wallet-savings-reconciliation-checkpoint';

describe('primary savings reconciliation checkpoint schema', () => {
  it('accepts only empty state or a complete bounded traversal cursor', () => {
    expect(schemas.state.parse(schemas.emptyState)).toEqual(schemas.emptyState);
    expect(
      schemas.state.parse({
        stage: 'date-window',
        fingerprint: 'a'.repeat(64),
        cursor: 'opaque-provider-cursor',
        pageDigest: 'b'.repeat(64),
      })
    ).toMatchObject({ stage: 'date-window', cursor: 'opaque-provider-cursor' });
    expect(
      schemas.state.safeParse({
        stage: 'full',
        fingerprint: 'a'.repeat(64),
        cursor: null,
        pageDigest: null,
      }).success
    ).toBe(false);
    expect(
      schemas.state.safeParse({
        stage: null,
        fingerprint: 'a'.repeat(64),
        cursor: 'cursor',
        pageDigest: 'b'.repeat(64),
      }).success
    ).toBe(false);
    expect(
      schemas.state.safeParse({
        stage: 'full',
        fingerprint: 'A'.repeat(64),
        cursor: 'cursor',
        pageDigest: 'b'.repeat(64),
      }).success
    ).toBe(false);
    expect(
      schemas.state.safeParse({
        stage: 'full',
        fingerprint: 'a'.repeat(64),
        cursor: 'c'.repeat(513),
        pageDigest: 'b'.repeat(64),
      }).success
    ).toBe(false);
  });

  it('accepts only strict fenced claim outcomes', () => {
    expect(schemas.claim.parse({ status: 'busy' })).toEqual({ status: 'busy' });
    expect(schemas.claim.parse({ status: 'stale' })).toEqual({
      status: 'stale',
    });
    expect(
      schemas.claim.safeParse({
        status: 'acquired',
        claimToken: 'not-a-uuid',
        state: schemas.emptyState,
      }).success
    ).toBe(false);
    expect(
      schemas.claim.safeParse({ status: 'busy', state: schemas.emptyState })
        .success
    ).toBe(false);
  });

  it('validates strict save and finish commands', () => {
    const command = {
      operationId: '00000000-0000-4000-8000-000000000001',
      claimToken: '00000000-0000-4000-8000-000000000000',
      stage: 'full',
      fingerprint: 'a'.repeat(64),
      cursor: 'cursor',
      pageDigest: 'b'.repeat(64),
    };
    expect(schemas.saveCommand.parse(command)).toEqual(command);
    expect(
      schemas.saveCommand.safeParse({ ...command, extra: true }).success
    ).toBe(false);
    expect(
      schemas.finishCommand.parse({
        operationId: command.operationId,
        claimToken: command.claimToken,
        reset: false,
      })
    ).toEqual({
      operationId: command.operationId,
      claimToken: command.claimToken,
      reset: false,
    });
    expect(
      schemas.finishCommand.safeParse({
        operationId: command.operationId,
        claimToken: command.claimToken,
        reset: false,
        extra: true,
      }).success
    ).toBe(false);
  });
});
