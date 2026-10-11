import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyDeliveryGuard } from './delivery.mjs';
import { outputFileName } from './manifest.mjs';

// Delivery disposition + manifest assembly for one encoded ladder:
// per-rung never-larger decisions against the hash-verified snapshot,
// pass-through staging, manifest tiers, and the commit file list.
// Split from generate-job.mjs under the repo line ceiling.
export async function buildDisposition({
  encoderIdentity,
  job,
  ladder,
  recipeId,
  snapshot,
  stagingBudget,
  stagingDir,
}) {
  const sourceFacts = {
    bytes: snapshot.bytes.length,
    format: ladder.source.format,
    orientedHeight: ladder.source.orientedHeight,
    orientedWidth: ladder.source.orientedWidth,
    sha256: job.expectedSha256,
  };
  // Never-larger delivery guard: per-rung body-byte decision against the
  // hash-verified snapshot. Pass-through rungs reuse the validated source
  // bytes (committed as copies below); nothing here re-reads or rehashes
  // loosely — commitGeneration re-verifies every staged file.
  const decided = applyDeliveryGuard({
    source: sourceFacts,
    tiers: ladder.tiers,
  });
  const stagedPassthrough = new Map();
  const passthroughFrom = async (format) => {
    const cached = stagedPassthrough.get(format);
    if (cached) {
      return cached;
    }
    const from = join(stagingDir, `passthrough.${format}`);
    await writeFile(from, snapshot.bytes, { flag: 'wx' });
    stagingBudget.charge(snapshot.bytes.length);
    stagedPassthrough.set(format, from);
    return from;
  };
  const manifestTiers = [];
  for (const tier of decided) {
    const sha256 =
      tier.delivery === 'original-passthrough'
        ? job.expectedSha256
        : tier.sha256;
    manifestTiers.push({
      actualWidth: tier.actualWidth,
      bytes: tier.bytes,
      contentType: tier.contentType,
      delivery: tier.delivery,
      format: tier.format,
      height: tier.height,
      path: outputFileName(sha256, tier.format),
      quality: tier.quality,
      requestedWidth: tier.requestedWidth,
      sha256,
      width: tier.width,
    });
  }
  const manifest = {
    assetId: job.assetId,
    createdAt: new Date().toISOString(),
    encoder: encoderIdentity,
    merchantId: job.merchantId,
    policyVersion: 1,
    recipeId,
    role: job.role,
    schemaVersion: 1,
    source: sourceFacts,
    tiers: manifestTiers,
  };
  const seen = new Set();
  const files = [];
  for (const tier of decided) {
    const sha256 =
      tier.delivery === 'original-passthrough'
        ? job.expectedSha256
        : tier.sha256;
    const name = outputFileName(sha256, tier.format);
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const from =
      tier.delivery === 'original-passthrough'
        ? await passthroughFrom(tier.format)
        : tier.path;
    files.push({ from, name });
  }
  return { files, manifest };
}
