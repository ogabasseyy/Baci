import { createHash } from 'node:crypto';

/** Correlates a response with Baci logs. The hash is public and unsigned. */
export function createBrilStashPageCorrelation(
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
