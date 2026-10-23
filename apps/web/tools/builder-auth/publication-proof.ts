/** Private verifier credential has INSERT-only evidence authority, never business/session access. */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { hasSafeBuilderPreviewAssets } from '../../src/schemas/builder-preview-assets';
import {
  type PublicationProof,
  publicationProofSchema,
} from '../../src/schemas/builder-publication';
import { portableHomeSchema } from '../../src/schemas/portable-storefront';
export function createPublicationProofWriter(pool: Pool) {
  const write = async (input: PublicationProof) => {
    const proof = publicationProofSchema.parse(input);
    const id = randomUUID();
    await pool.query(
      'INSERT INTO builder_authorization.publication_checks(id,intent_id,receipt_id,kind,version,effect_digest) VALUES($1,$2,$3,$4,$5,$6)',
      [
        id,
        proof.intentId,
        proof.receiptId,
        proof.kind,
        proof.version,
        proof.effectDigest,
      ]
    );
    return id;
  };
  return {
    certifyRender: async (input: PublicationProof, config: unknown) => {
      const parsed = portableHomeSchema.parse(config);
      if (
        input.kind !== 'render' ||
        input.receiptId !== null ||
        !hasSafeBuilderPreviewAssets(parsed)
      )
        throw Error('Unsupported render proof');
      return await write(input);
    },
    certifyDelivery: async (input: PublicationProof) => {
      if (input.kind !== 'delivery' || !input.receiptId)
        throw Error('Invalid delivery proof');
      return await write(input);
    },
  };
}
