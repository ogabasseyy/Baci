import { createHash } from 'node:crypto';

export function createBrilStashPageProof(
  requestId: string,
  page: { generationId: string; credentialId: string; payloadDigest: string }
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'brilstash-page-v1',
        requestId,
        page.generationId,
        page.credentialId,
        page.payloadDigest,
      ])
    )
    .digest('hex');
}
