import { z } from 'zod';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { createPortablePublishedSnapshot } from '@/lib/portable-published-snapshot';
import { stableStringify } from '@/lib/stable-stringify';
import { hasSafeBuilderPreviewAssets } from '@/schemas/builder-preview-assets';
import { experienceModeExitInput } from '@/schemas/experience-mode-exit';

const revision = z.number().int().nonnegative();
const legacyEffect = z.object({
  namespace: z.literal('baci.full-code.lifecycle.v1'),
  action: experienceModeExitInput.shape.effect,
  merchant: z.uuid(),
  payload: z.object({
    expectedDraftVersion: revision,
    expectedPublishedVersion: revision,
    targetLegacyRevision: z.uuid(),
  }),
  website: z.uuid(),
  draft: revision,
  published: revision,
  template: z.string().nullable(),
  legacy: z.object({ config: z.json(), published: z.boolean().optional() }),
});

/** The authenticated SQL load rederives the exact legacy target from current
 * revisions. Validate its supported presentation independently of the runner. */
export async function createModeExitProof(approval: {
  action: unknown;
  summary: unknown;
  merchantId: string;
  effectDigest: string;
}) {
  const target = legacyEffect.parse(approval.summary);
  if (
    target.action !== approval.action ||
    target.merchant !== approval.merchantId ||
    target.payload.targetLegacyRevision !== target.website ||
    target.payload.expectedDraftVersion !== target.draft ||
    target.payload.expectedPublishedVersion !== target.published
  )
    throw Error('APPROVAL_MISMATCH');

  let presentationVersion: string | null = null;
  if (target.action === 'restore-legacy') {
    if (target.template !== 'puck' || target.legacy.published !== true)
      throw Error('INCOMPATIBLE_LEGACY');
    const presentation = await createPortablePublishedSnapshot(
      target.legacy.config
    );
    if (!hasSafeBuilderPreviewAssets(presentation.config))
      throw Error('INCOMPATIBLE_LEGACY');
    presentationVersion = presentation.publishedVersion;
  }
  const artifactReceipt = digestBytes(stableStringify(target));
  return {
    effectDigest: approval.effectDigest,
    artifactReceipt,
    evidenceDigest: digestBytes(
      stableStringify({
        format: 'baci.legacy-mode-exit/v1',
        artifactReceipt,
        effectDigest: approval.effectDigest,
        presentation: presentationVersion,
      })
    ),
    routes: ['/'],
  };
}
