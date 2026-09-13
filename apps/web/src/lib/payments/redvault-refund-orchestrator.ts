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
  const providerReference = claim.refund.providerReference;
  if (!providerReference) {
    throw new Error('REDVAULT reconciliation claim has no provider reference');
  }
  const outcome = await provider.lookup({
    providerReference,
  });
  const refund = await store.reconcile({
    id: claim.refund.id,
    providerStatus: outcome.providerStatus,
    reconciliationClaimToken: claim.reconciliationClaimToken,
  });
  return { kind: outcome.kind, refund };
}
