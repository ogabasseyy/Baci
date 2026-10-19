import 'server-only';
import { primaryWalletCardCustodySchemas as schemas } from '@/schemas/primary-wallet-card-custody';

export async function runPrimaryCardTransfer(input: {
  operationId: string;
  claim: (operationId: string) => Promise<unknown>;
  submitTransfer: (
    command: ReturnType<typeof schemas.command.parse>
  ) => Promise<void>;
  lookupTransfer: (
    command: ReturnType<typeof schemas.command.parse>
  ) => Promise<'submitted' | 'absent' | 'uncertain'>;
  record: (
    operationId: string,
    token: string,
    submitted: boolean
  ) => Promise<unknown>;
  requeue: (operationId: string, token: string) => Promise<unknown>;
}) {
  const operationId = schemas.context.shape.operationId.parse(
    input.operationId
  );
  const claim = schemas.claim.parse(await input.claim(operationId));
  if (claim.outcome !== 'claimed' && claim.outcome !== 'reclaimed')
    return 'existing' as const;
  if (
    claim.command.operationId !== operationId ||
    claim.command.reference !== `pvb-primary-transfer-${operationId}` ||
    claim.command.sourceWalletId === claim.command.destinationWalletId
  )
    throw new Error('Transfer claim unavailable');
  // A reclaimed lease means the previous holder may have submitted before
  // dying: verify the provider reference first. 'submitted' records the
  // existing transfer without resubmitting; only a proven-absent
  // reference submits fresh; anything uncertain records unknown and never
  // resubmits blind.
  if (claim.outcome === 'reclaimed') {
    let observed: 'submitted' | 'absent' | 'uncertain';
    try {
      observed = await input.lookupTransfer(claim.command);
    } catch {
      observed = 'uncertain';
    }
    if (observed === 'submitted') {
      const acknowledged = await input.record(operationId, claim.token, true);
      if (acknowledged !== true) throw new Error('Transfer result unavailable');
      return 'submitted' as const;
    }
    if (observed === 'uncertain') {
      const acknowledged = await input.record(operationId, claim.token, false);
      if (acknowledged !== true) throw new Error('Transfer result unavailable');
      return 'unknown' as const;
    }
  }
  try {
    await input.submitTransfer(claim.command);
  } catch {
    // A submit throw is ambiguous: reconcile the deterministic reference
    // before recording. Proven-absent requeues for the next pass with the
    // identical reference; proven-submitted records without resubmitting;
    // anything uncertain records unknown and never resubmits blind.
    let observed: 'submitted' | 'absent' | 'uncertain';
    try {
      observed = await input.lookupTransfer(claim.command);
    } catch {
      observed = 'uncertain';
    }
    if (observed === 'absent') {
      const requeued = await input.requeue(operationId, claim.token);
      if (requeued !== true) throw new Error('Transfer result unavailable');
      return 'requeued' as const;
    }
    const acknowledged = await input.record(
      operationId,
      claim.token,
      observed === 'submitted'
    );
    if (acknowledged !== true) throw new Error('Transfer result unavailable');
    return observed === 'submitted'
      ? ('submitted' as const)
      : ('unknown' as const);
  }
  const acknowledged = await input.record(operationId, claim.token, true);
  if (acknowledged !== true) throw new Error('Transfer result unavailable');
  return 'submitted' as const;
}
