import 'server-only';
import { createHash } from 'node:crypto';
import { prefundedCardProviderEvidenceSchemas } from '@/schemas/prefunded-card-provider-evidence';
import { primaryWalletCardCustodySchemas as schemas } from '@/schemas/primary-wallet-card-custody';
import { verifyPrimaryCardCustodyProof } from './primary-wallet-card-custody-proof';
import type { createPrimaryCardCustodyReader } from './primary-wallet-card-custody-reader';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

export async function applyPrimaryCardSignedCustody(input: {
  rawBody: Uint8Array;
  signature: string | null;
  secret: string | undefined;
  retainedSecrets?: readonly string[];
  operationId: string;
  inboxToken: string;
  loadContext: (operationId: string) => Promise<unknown>;
  observe: ReturnType<typeof createPrimaryCardCustodyReader>;
  settle: (proof: ReturnType<typeof schemas.proof.parse>) => Promise<unknown>;
  now?: () => number;
}) {
  if (
    input.rawBody.byteLength === 0 ||
    input.rawBody.byteLength > 65536 ||
    ![input.secret, ...(input.retainedSecrets ?? [])].some((secret) =>
      verifyPiggyvestPayloadSignature({
        payload: input.rawBody,
        signature: input.signature,
        secret,
      })
    )
  )
    throw new Error('Custody authentication failed');
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody)
    );
  } catch {
    return 'deferred' as const;
  }
  const selected = schemas.context.shape.operationId.safeParse(
    input.operationId
  );
  const parsed =
    prefundedCardProviderEvidenceSchemas.envelope.safeParse(decoded);
  if (
    !selected.success ||
    !parsed.success ||
    parsed.data.eventType !== 'wallet-transfer.outflow.success' ||
    parsed.data.eventCategory !== 'wallet-transfer'
  )
    return 'deferred' as const;
  const loaded = await input.loadContext(selected.data);
  const context = schemas.context.parse(loaded);
  if (context.operationId !== selected.data) return 'deferred' as const;
  const observations = await input.observe(context, parsed.data);
  const result = verifyPrimaryCardCustodyProof({
    ...observations,
    context,
    envelope: parsed.data,
    bodyDigest: createHash('sha256').update(input.rawBody).digest('hex'),
    inboxToken: input.inboxToken,
    now: (input.now ?? Date.now)(),
  });
  if (result.status !== 'verified') return 'deferred' as const;
  const acknowledgement = await input.settle(result.proof);
  return schemas.outcome.parse(acknowledgement);
}
