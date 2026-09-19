import type {
  RedvaultRefund,
  RedvaultRefundStore,
} from './redvault-refund-store';

export type RedvaultRefundProviderResult =
  | {
      kind: 'accepted_pending';
      providerReference: string;
      providerStatus: string;
    }
  | { kind: 'processed'; providerReference: string; providerStatus: string }
  | { kind: 'failed'; providerStatus?: string }
  | { kind: 'indeterminate' };

export interface RedvaultRefundProvider {
  submit(input: {
    amountKobo: number;
    originalCaptureReference: string;
  }): Promise<RedvaultRefundProviderResult>;
}

export interface RedvaultRefundReconciliationProvider {
  lookup(input: {
    providerReference: string;
    expectedAmountKobo: number;
    expectedCaptureReference: string;
    expectedCurrency: string;
  }): Promise<
    | { kind: 'pending'; providerStatus: string }
    | { kind: 'processed'; providerStatus: string }
    | { kind: 'failed'; providerStatus: string }
  >;
}

export async function processNextRedvaultRefund({
  provider,
  store,
}: {
  provider: RedvaultRefundProvider;
  store: Pick<
    RedvaultRefundStore,
    | 'claimNext'
    | 'finish'
    | 'recordProviderSubmission'
    | 'markSubmissionIndeterminate'
  >;
}): Promise<
  | { kind: 'idle' }
  | { kind: 'failed'; refund: RedvaultRefund }
  | { kind: 'indeterminate'; refund: RedvaultRefund }
  | { kind: 'processed'; refund: RedvaultRefund }
> {
  const refund = await store.claimNext();
  if (!refund) return { kind: 'idle' };

  let outcome: RedvaultRefundProviderResult;
  try {
    outcome = await provider.submit({
      amountKobo: refund.amountKobo,
      originalCaptureReference: refund.attemptReference,
    });
  } catch {
    return {
      kind: 'indeterminate',
      refund: await store.markSubmissionIndeterminate(refund.id),
    };
  }

  if (outcome.kind === 'indeterminate')
    return {
      kind: 'indeterminate',
      refund: await store.markSubmissionIndeterminate(refund.id),
    };
  if (outcome.kind === 'accepted_pending') {
    return {
      kind: 'indeterminate',
      refund: await store.recordProviderSubmission({
        id: refund.id,
        providerReference: outcome.providerReference,
        providerStatus: outcome.providerStatus,
      }),
    };
  }
  if (outcome.kind === 'failed') {
    return {
      kind: 'failed',
      refund: await store.finish({
        id: refund.id,
        outcome: 'failed',
        providerStatus: outcome.providerStatus,
      }),
    };
  }
  // The provider already settled this refund externally. Persist the provider
  // reference first (leaving the row recoverable through reconciliation),
  // then finalize: finish runs settlement/inventory triggers in the same
  // transaction, so a finalizer failure after a direct finish would strand
  // the row in processing with no reference for any runner to recover.
  await store.recordProviderSubmission({
    id: refund.id,
    providerReference: outcome.providerReference,
    providerStatus: outcome.providerStatus,
  });
  return {
    kind: 'processed',
    refund: await store.finish({
      id: refund.id,
      outcome: 'processed',
      providerReference: outcome.providerReference,
      providerStatus: outcome.providerStatus,
    }),
  };
}

export async function reconcileNextRedvaultRefund({
  provider,
  store,
}: {
  provider: RedvaultRefundReconciliationProvider;
  store: Pick<RedvaultRefundStore, 'claimNextReconciliation' | 'reconcile'>;
}): Promise<
  | { kind: 'idle' }
  | { kind: 'pending'; refund: RedvaultRefund }
  | { kind: 'failed'; refund: RedvaultRefund }
  | { kind: 'processed'; refund: RedvaultRefund }
> {
  const claim = await store.claimNextReconciliation();
  if (!claim) return { kind: 'idle' };
  // Indeterminate submissions may carry no provider reference (provider
  // timeout, non-2xx, or unverifiable response). Resolve those through the
  // original capture reference, which the provider lookup accepts, so the
  // refund stays recoverable instead of stranding in needs_reconciliation.
  const providerReference =
    claim.refund.providerReference ?? claim.refund.attemptReference;
  const outcome = await provider.lookup({
    providerReference,
    expectedAmountKobo: claim.refund.amountKobo,
    expectedCaptureReference: claim.refund.attemptReference,
    expectedCurrency: 'NGN',
  });
  const refund = await store.reconcile({
    id: claim.refund.id,
    providerStatus: outcome.providerStatus,
    reconciliationClaimToken: claim.reconciliationClaimToken,
  });
  return { kind: outcome.kind, refund };
}
