import 'server-only';
import { primaryWalletCardCustodySchemas as schemas } from '@/schemas/primary-wallet-card-custody';
import type { TransferReferenceLookup } from './transfer-reference-lookup';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

type Command = ReturnType<typeof schemas.command.parse>;

export async function runPrimaryCardTransfer(input: {
  operationId: string;
  claim: (operationId: string) => Promise<unknown>;
  submitTransfer: (command: Command) => Promise<void>;
  lookupTransfer: (command: Command) => Promise<TransferReferenceLookup>;
  record: (
    operationId: string,
    token: string,
    submitted: boolean
  ) => Promise<unknown>;
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
  const settle = async (submitted: boolean) => {
    const acknowledged = await input.record(
      operationId,
      claim.token,
      submitted
    );
    if (acknowledged !== true) throw new Error('Transfer result unavailable');
    return submitted ? ('submitted' as const) : ('unknown' as const);
  };
  // A reclaimed lease (stale dispatch, or an 'unknown' row revisited after
  // its five-minute backoff) may follow a submission that already reached
  // PiggyVest, so it NEVER submits again. Only a successful bound transfer
  // records submitted; everything else — including a 404, which the sandbox
  // returned for a 202-accepted transfer before it was indexed
  // (docs/piggyvest-contract-evidence/2026-10-31.md, P2) — records unknown,
  // which keeps reconciliation_required and is re-probed.
  // A reference still not found (or reported failed) this far past the
  // indexing window is raised for operator review on every revisit.
  if (claim.outcome === 'reclaimed') {
    const observed = await observe(input, claim.command);
    if (observed === 'not_found' || observed === 'failed')
      emitPiggyvestWebhookAlert('PIGGYVEST_TRANSFER_NEEDS_REVIEW', {
        reason: `card_reference_${observed}`,
        operationId,
      });
    return await settle(observed === 'submitted');
  }
  try {
    await input.submitTransfer(claim.command);
  } catch {
    // A submit throw is ambiguous: the provider may have accepted it. The
    // identical reference is never resubmitted; an unproven outcome is
    // held as unknown for the revisit and, if it persists, for review.
    return await settle((await observe(input, claim.command)) === 'submitted');
  }
  return await settle(true);
}

async function observe(
  input: {
    lookupTransfer: (command: Command) => Promise<TransferReferenceLookup>;
  },
  command: Command
): Promise<TransferReferenceLookup> {
  try {
    return await input.lookupTransfer(command);
  } catch {
    return 'uncertain';
  }
}
