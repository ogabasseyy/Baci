import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { prefundedCardTransferVerificationSchemas } from '@/schemas/prefunded-card-transfer-verification';
import { primaryWalletSavingsIdentitySchemas } from '@/schemas/primary-wallet-savings-identity';
import { primaryWalletSavingsReconciliationCheckpointSchemas as schemas } from '@/schemas/primary-wallet-savings-reconciliation-checkpoint';
import { savingsIdentityFixture as fixture } from './primary-wallet-savings-identity.test-fixture';
import {
  primarySavingsIdentityCheckpointFingerprint,
  scanPrimarySavingsIdentityList,
} from './primary-wallet-savings-identity-scan';

const base = {
  reservation: piggyvestPrimarySavingsTransferSchemas.reserved.parse(
    fixture.reservation
  ),
  actual: prefundedCardTransferVerificationSchemas.rich.parse(
    fixture.providerResponse
  ).data,
  direct: primaryWalletSavingsIdentitySchemas.singleTransaction.parse(
    fixture.singleTransaction
  ),
  walletId: fixture.wallet.id,
  scope: {
    integrationId: '00000000-0000-4000-8000-000000000004',
    environment: 'production' as const,
  },
  stage: 'full' as const,
  window: null,
  pageSize: 100,
  maxPages: 2,
  pageResponseBytes: 1_048_576,
  fallbackReserveMs: 0,
};
function page(
  edges: unknown[],
  endCursor: string | null = null,
  hasNextPage = false
) {
  return { edges, pageInfo: { hasNextPage, endCursor } };
}
function checkpoint(state: z.infer<typeof schemas.state> = schemas.emptyState) {
  return { state: schemas.state.parse(state), save: vi.fn(async () => true) };
}

describe('primary savings identity list checkpoint', () => {
  it('uses a matching scoped cursor only as the starting point for exact list proof', async () => {
    const fingerprint = primarySavingsIdentityCheckpointFingerprint(base);
    expect(fingerprint).not.toBe(
      primarySavingsIdentityCheckpointFingerprint({
        ...base,
        scope: {
          integrationId: '99999999-9999-4999-8999-999999999999',
          environment: 'production',
        },
      })
    );
    const saved = checkpoint({
      stage: 'full',
      fingerprint,
      cursor: 'provider-next',
      pageDigest: 'a'.repeat(64),
    });
    let requested = '';
    const result = await scanPrimarySavingsIdentityList({
      ...base,
      checkpoint: saved,
      getData: async (path) => {
        requested = path;
        return page([fixture.transaction]);
      },
    });
    expect(
      new URL(`https://provider.example${requested}`).searchParams.get('cursor')
    ).toBe('provider-next');
    expect(result).toEqual({
      status: 'matched',
      transaction: fixture.transaction,
    });
  });

  it('rejects a repeated page/cursor and a duplicate target before returning evidence', async () => {
    const oldPageDigest = await scanPrimarySavingsIdentityList({
      ...base,
      maxPages: 1,
      getData: async () => page([{ id: 'previous' }], 'provider-next', true),
    });
    expect(oldPageDigest.status).toBe('incomplete');
    const fingerprint = primarySavingsIdentityCheckpointFingerprint(base);
    const repeated = checkpoint({
      stage: 'full',
      fingerprint,
      cursor: 'provider-next',
      pageDigest: 'a'.repeat(64),
    });
    const repeatedResult = await scanPrimarySavingsIdentityList({
      ...base,
      checkpoint: repeated,
      getData: async () => page([{ id: 'previous' }], 'provider-next', true),
    });
    expect(repeatedResult.status).toBe('invalid');

    const duplicateResult = await scanPrimarySavingsIdentityList({
      ...base,
      getData: async () => page([fixture.transaction, fixture.transaction]),
    });
    expect(duplicateResult.status).toBe('invalid');
  });

  it('rejects a target whose documented list amount or wallet identity differs', async () => {
    for (const change of [{ amount: -9999 }, { wallet_id: 'foreign-wallet' }]) {
      const result = await scanPrimarySavingsIdentityList({
        ...base,
        getData: async () => page([{ ...fixture.transaction, ...change }]),
      });
      expect(result.status).toBe('invalid');
    }
  });

  it('keeps a bounded continuation only after a valid nonterminal page', async () => {
    const saved = checkpoint();
    const result = await scanPrimarySavingsIdentityList({
      ...base,
      maxPages: 1,
      checkpoint: saved,
      getData: async () => page([{ id: 'older' }], 'next-page', true),
    });
    expect(result.status).toBe('incomplete');
    expect(saved.save).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'full',
        cursor: 'next-page',
        pageDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    );
  });
});
