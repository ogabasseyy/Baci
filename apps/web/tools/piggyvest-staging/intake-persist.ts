import type { z } from 'zod';
import { signedIntakeSchemas } from './schemas/intake-signed';

export function createIntakePersistence(
  restToken: string,
  fetcher: typeof fetch = fetch
) {
  return async (input: z.input<typeof signedIntakeSchemas.sealed>) => {
    const sealed = signedIntakeSchemas.sealed.parse(input);
    const response = await fetcher(
      'http://pvb-staging-receipts-rest:3000/rpc/accept_signed_piggyvest_staging_receipt',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${restToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_payload_sha256: sealed.payloadSha256,
          p_ciphertext: sealed.ciphertext,
          p_nonce: sealed.nonce,
          p_auth_tag: sealed.authTag,
          p_key_version: sealed.keyVersion,
          p_original_signature: sealed.originalSignature,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!response.ok) throw new Error('Durable staging receipt unavailable');
    return signedIntakeSchemas.receipt.parse(await response.json());
  };
}
