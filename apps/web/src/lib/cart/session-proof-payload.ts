import { Buffer } from 'node:buffer';
import { z } from 'zod';

const cartOperationSchema = z.enum([
  'add',
  'set_quantity',
  'remove',
  'clear',
  'replace',
  'set_assurance',
  'set_negotiated_price',
]);

export const proofPayloadSchema = z.strictObject({
  aud: z.string().min(1).max(128),
  cartId: z.uuid().nullable(),
  env: z.string().min(1).max(64),
  exp: z.number().int().positive(),
  grantId: z.uuid().nullable(),
  iat: z.number().int().positive(),
  merchantId: z.uuid(),
  // Grant operations encoded at issuance; absent on proofs minted
  // before this claim existed. Those legacy proofs fail closed with
  // no mutation operations until the server re-issues them.
  ops: z.array(cartOperationSchema).max(7).optional(),
  principalId: z.string().min(1).max(128),
  scope: z.enum(['bootstrap', 'session']),
  v: z.literal('cp1'),
});

export type ProofPayload = z.infer<typeof proofPayloadSchema>;

export function encodeProofPayload(payload: ProofPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeProofPayload(payload: string): ProofPayload | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );
    const result = proofPayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
