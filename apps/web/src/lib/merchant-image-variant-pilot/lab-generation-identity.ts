import { createHash } from 'node:crypto';

// Exact mirror of generationIdFor in
// infra/cdn-transformer/pilot/generation-identity.mjs. The JSON key order
// is load-bearing (it feeds the digest), so the literal below keeps the
// transformer's field order even where the local types would sort
// differently. lab-generation-identity.test.mjs pins parity against the
// original; web runtime code must not import infra directly.
export function labGenerationIdFor(input: {
  assetId: string;
  encoderIdentity: {
    libvipsVersion: string;
    name: string;
    sharpVersion: string;
  };
  merchantId: string;
  recipeId: string;
  role: string;
  sourceSha256: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        assetId: input.assetId,
        encoderIdentity: {
          libvipsVersion: input.encoderIdentity.libvipsVersion,
          name: input.encoderIdentity.name,
          sharpVersion: input.encoderIdentity.sharpVersion,
        },
        merchantId: input.merchantId,
        recipeId: input.recipeId,
        role: input.role,
        sourceSha256: input.sourceSha256,
      })
    )
    .digest('hex');
}
