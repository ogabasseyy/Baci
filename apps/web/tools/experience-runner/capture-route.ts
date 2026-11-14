import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import type { ExperienceSnapshotKey } from '../../src/lib/experience/snapshot-freshness';
import { createVisualEvidence } from '../../src/lib/experience/visual-evidence';
import { runLocalQualification } from './local-oci-executor';
import type { OfflineAsset } from './materialize-assets';
import { validateSemanticSnapshot } from './semantic-snapshot';
export async function captureExperience(
  input: {
    manifest: ExperienceManifest;
    hostOrigin?: string;
    bundle: { javascript: string; css: string; digest: string };
    bootstrap: PublicBootstrap;
    assets: OfflineAsset[];
    engine: 'chromium' | 'firefox' | 'webkit';
    width: number;
    reducedMotion?: boolean;
    locale?: string;
    assetsDigest: string;
  },
  execute: typeof runLocalQualification = runLocalQualification
) {
  if (![360, 390, 768, 1280, 1440].includes(input.width))
    throw Error('INVALID_VIEWPORT');
  const capture = await execute('capture', {
    ...input,
    mode: 'checkpoint-b',
    semanticCapture: true,
    verificationOnly: true,
  });
  const result = capture.output as Record<string, unknown>;
  if (
    result.status !== 'passed' ||
    result.buildDigest !== input.bundle.digest ||
    typeof result.screenshot !== 'string' ||
    !Array.isArray(result.semanticNodes)
  )
    throw Error('CAPTURE_FAILED');
  const snapshot = validateSemanticSnapshot({
    revision: input.bootstrap.catalog.revision,
    path: input.bootstrap.route.canonicalPath,
    nodes: result.semanticNodes,
  });
  const key: ExperienceSnapshotKey = {
    build: input.bundle.digest,
    assets: input.assetsDigest,
    catalog: input.bootstrap.catalog.revision,
    path: snapshot.path,
    viewport: String(input.width),
    locale: input.locale ?? 'en-NG',
    browser: input.engine,
    state: input.reducedMotion ? 'reduced-motion' : 'default',
  };
  const evidence = await createVisualEvidence(
    Buffer.from(result.screenshot, 'base64'),
    key
  );
  return {
    snapshot: { key, consumesCatalog: true, nodes: snapshot.nodes },
    evidence,
    jobId: capture.jobId,
  };
}
