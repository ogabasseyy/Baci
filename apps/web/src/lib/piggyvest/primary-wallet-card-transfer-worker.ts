import 'server-only';
import { primaryWalletCardCustodySchemas as schemas } from '@/schemas/primary-wallet-card-custody';

export async function runPrimaryCardTransfer(input: {
  operationId: string;
  claim: (operationId: string) => Promise<unknown>;
  submitTransfer: (
    command: ReturnType<typeof schemas.command.parse>
  ) => Promise<void>;
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
  if (claim.outcome !== 'claimed') return 'existing' as const;
  if (
    claim.command.operationId !== operationId ||
    claim.command.reference !== `pvb-primary-transfer-${operationId}` ||
    claim.command.sourceWalletId === claim.command.destinationWalletId
  )
    throw new Error('Transfer claim unavailable');
  let submitted = false;
  try {
    await input.submitTransfer(claim.command);
    submitted = true;
  } catch {
    submitted = false;
  }
  const acknowledged = await input.record(operationId, claim.token, submitted);
  if (acknowledged !== true) throw new Error('Transfer result unavailable');
  return submitted ? ('submitted' as const) : ('unknown' as const);
}
