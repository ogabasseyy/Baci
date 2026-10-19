import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prefundedCardTransferVerificationFixture as fixture } from '../../../../apps/web/src/lib/piggyvest/prefunded-card-transfer-verification.test-fixture';
import type { prefundedCardTransferVerificationSchemas } from '../../../../apps/web/src/schemas/prefunded-card-transfer-verification';
import { collectReviewedPrefundedTransferProof } from './collector';
import { reviewedTransferTarget as target } from './constants';

vi.mock('server-only', () => ({}));
vi.mock('./constants', async () => {
  const { createHash } = await import('node:crypto');
  const { prefundedCardTransferVerificationFixture: synthetic } = await import(
    '../../../../apps/web/src/lib/piggyvest/prefunded-card-transfer-verification.test-fixture'
  );
  return {
    reviewedTransferTarget: {
      claim: synthetic.claim,
      apiCustomerId: synthetic.ownership.crosswalk.apiCustomerId,
      systemIdentifier: '123',
      transactionId: synthetic.transaction.data.id,
      deadline: '2026-10-06T15:59:10Z',
      identitySha256: createHash('sha256')
        .update('synthetic independently reviewed identity')
        .digest('hex'),
      transactionAuditSha256: createHash('sha256')
        .update('synthetic authenticated original TSQ audit')
        .digest('hex'),
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-02T16:00:00.000Z');
  vi.spyOn(process, 'getuid').mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function options() {
  const approval: ReturnType<
    typeof prefundedCardTransferVerificationSchemas.reviewedApproval.parse
  > = {
    identitySha256: target.identitySha256,
    transactionAuditSha256: target.transactionAuditSha256,
    reviewedAt: '2026-10-02T16:00:00.000Z',
    expiresAt: '2026-10-02T16:01:00.000Z',
  };
  return {
    settings: fixture.settings,
    claim: fixture.claim,
    approval,
    identityArtifact: Buffer.from('synthetic independently reviewed identity'),
    transactionAuditArtifact: Buffer.from(
      'synthetic authenticated original TSQ audit'
    ),
    readReviewedOwnership: vi.fn().mockResolvedValue({
      ...fixture.ownership,
      crosswalk: {
        ...fixture.ownership.crosswalk,
        authority: 'owner_reviewed_provisioning_identity',
        evidenceSha256: target.identitySha256,
      },
    }),
    fetchImplementation: vi
      .fn()
      .mockImplementation(async (url: string) =>
        Response.json(
          url.includes('/transaction/verify?')
            ? fixture.transaction
            : url.endsWith('/wallet_source')
              ? fixture.sourceWallet
              : fixture.destinationWallet
        )
      ),
  };
}

it('collects exact-target proof using the same rich normalizer without claiming a webhook or applying SQL', async () => {
  const selected = options();
  const result = await collectReviewedPrefundedTransferProof(selected);
  expect(result).toMatchObject({
    outcome: 'verified_success',
    writesPerformed: false,
    evidence: {
      providerTransactionId: 'PVBsynthetic-transfer-id',
      amountKobo: 10000,
      destinationCustomerId: 'customer_destination',
    },
  });
  expect(result.verifiedAt).toBe('2026-10-02T16:00:00.000Z');
  expect(result.expiresAt).toBe('2026-10-02T16:01:00.000Z');
  expect(selected.fetchImplementation).toHaveBeenCalledTimes(3);
  expect(selected.readReviewedOwnership).toHaveBeenCalledOnce();
  for (const [, init] of selected.fetchImplementation.mock.calls)
    expect(init.method).toBe('GET');
  expect(result).not.toHaveProperty('signature');
});

it('refuses flat receipts instead of bypassing reviewed ownership and both wallet GETs', async () => {
  const selected = options();
  selected.fetchImplementation.mockResolvedValue(
    Response.json({
      status: true,
      data: {
        status: 'success',
        id: target.transactionId,
        reference: fixture.claim.transferReference,
        amount: fixture.claim.amountKobo,
        currency: fixture.claim.currency,
        business_id: fixture.claim.businessId,
        source_wallet: fixture.claim.sourceWalletId,
        destination_wallet: fixture.claim.destinationWalletId,
        destination_customer_id: fixture.claim.destinationCustomerId,
      },
    })
  );
  await expect(collectReviewedPrefundedTransferProof(selected)).rejects.toThrow(
    'REVIEWED_TRANSFER_PROOF_REFUSED'
  );
  expect(selected.fetchImplementation).toHaveBeenCalledOnce();
  expect(selected.readReviewedOwnership).not.toHaveBeenCalled();
});

it('sanitizes ownership-reader failures instead of returning private proof details', async () => {
  const selected = options();
  selected.readReviewedOwnership.mockRejectedValue(
    new Error('private captured provider body')
  );
  await expect(collectReviewedPrefundedTransferProof(selected)).rejects.toThrow(
    /^REVIEWED_TRANSFER_PROOF_REFUSED$/
  );
  expect(selected.fetchImplementation).toHaveBeenCalledOnce();
});

it('refuses proof that finishes after its private approval expires', async () => {
  const selected = options();
  selected.readReviewedOwnership.mockImplementation(async () => {
    vi.setSystemTime('2026-10-02T16:01:00.000Z');
    return {
      ...fixture.ownership,
      crosswalk: {
        ...fixture.ownership.crosswalk,
        authority: 'owner_reviewed_provisioning_identity',
        evidenceSha256: target.identitySha256,
      },
    };
  });
  await expect(collectReviewedPrefundedTransferProof(selected)).rejects.toThrow(
    'REVIEWED_TRANSFER_PROOF_REFUSED'
  );
});

it('refuses non-root callers before any proof or provider access', async () => {
  vi.spyOn(process, 'getuid').mockReturnValue(1001);
  const selected = options();
  await expect(collectReviewedPrefundedTransferProof(selected)).rejects.toThrow(
    'REVIEWED_TRANSFER_PROOF_REFUSED'
  );
  expect(selected.fetchImplementation).not.toHaveBeenCalled();
  expect(selected.readReviewedOwnership).not.toHaveBeenCalled();
});

it.each([
  'identityArtifact',
  'transactionAuditArtifact',
] as const)('requires original %s bytes rather than a supplied digest assertion', async (field) => {
  const selected = options();
  selected[field] = Buffer.from('tampered');
  await expect(collectReviewedPrefundedTransferProof(selected)).rejects.toThrow(
    'REVIEWED_TRANSFER_PROOF_REFUSED'
  );
  expect(selected.fetchImplementation).not.toHaveBeenCalled();
});

it.each([
  'operationId',
  'goalId',
  'destinationWalletId',
  'amountKobo',
  'transferReference',
])('refuses another target %s before any GET', async (field) => {
  const selected = options();
  selected.claim = {
    ...selected.claim,
    [field]: field === 'amountKobo' ? 9999 : 'foreign',
  };
  await expect(collectReviewedPrefundedTransferProof(selected)).rejects.toThrow(
    'REVIEWED_TRANSFER_PROOF_REFUSED'
  );
  expect(selected.fetchImplementation).not.toHaveBeenCalled();
});

it.each([
  { reviewedAt: '2026-10-02T16:00:01.000Z' },
  { reviewedAt: '2026-10-02T15:58:00.000Z' },
  { expiresAt: '2026-10-02T16:00:00.000Z' },
  { expiresAt: '2026-10-02T16:01:01.000Z' },
  { identitySha256: 'f'.repeat(64) },
  { transactionAuditSha256: 'f'.repeat(64) },
])('refuses future, stale, overlong or differently pinned approvals %o', async (changed) => {
  const selected = options();
  selected.approval = { ...selected.approval, ...changed };
  await expect(collectReviewedPrefundedTransferProof(selected)).rejects.toThrow(
    'REVIEWED_TRANSFER_PROOF_REFUSED'
  );
  expect(selected.fetchImplementation).not.toHaveBeenCalled();
});

it('refuses the global deadline even if a caller supplies renewed timestamps', async () => {
  vi.setSystemTime('2026-10-06T15:59:10.000Z');
  const selected = options();
  selected.approval.reviewedAt = '2026-10-06T15:59:10.000Z';
  selected.approval.expiresAt = '2026-10-06T15:59:11.000Z';
  await expect(collectReviewedPrefundedTransferProof(selected)).rejects.toThrow(
    'REVIEWED_TRANSFER_PROOF_REFUSED'
  );
  expect(selected.fetchImplementation).not.toHaveBeenCalled();
});

it('cannot turn a reviewed historical alias into another webhook owner or provider transaction', async () => {
  for (const mismatch of ['owner', 'transaction']) {
    const selected = options();
    if (mismatch === 'owner')
      selected.readReviewedOwnership.mockResolvedValue({
        ...fixture.ownership,
        crosswalk: {
          ...fixture.ownership.crosswalk,
          authority: 'owner_reviewed_provisioning_identity',
          evidenceSha256: target.identitySha256,
          webhookCustomerId: 'foreign-owner',
        },
      });
    else
      selected.fetchImplementation.mockResolvedValue(
        Response.json({
          ...fixture.transaction,
          data: {
            ...fixture.transaction.data,
            id: 'another-paid-id',
            internal_reference: 'another-paid-id',
          },
        })
      );
    await expect(
      collectReviewedPrefundedTransferProof(selected)
    ).rejects.toThrow('REVIEWED_TRANSFER_PROOF_REFUSED');
  }
});
