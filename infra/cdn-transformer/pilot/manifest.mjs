import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename as fsRename,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  PILOT_POLICY_VERSION,
  PILOT_SCHEMA_VERSION,
  TIERS,
} from './constants.mjs';
import { removeOwnedStaging } from './disk-guards.mjs';
import { generationIdFor } from './generation-identity.mjs';

export class PilotManifestError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'PilotManifestError';
  }
}

export {
  buildEncoderIdentity,
  currentRecipeId,
  generationIdFor,
} from './generation-identity.mjs';

export function outputFileName(sha256, format) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new PilotManifestError('bad-request', 'output name needs a sha256');
  }
  if (format !== 'avif' && format !== 'webp') {
    throw new PilotManifestError('bad-request', 'output name needs a format');
  }
  return `${sha256}.${format}`;
}

const TierSchema = z
  .object({
    actualWidth: z.number().int().min(1).max(16384),
    bytes: z.number().int().min(1),
    contentType: z.enum(['image/avif', 'image/webp']),
    // Never-larger delivery disposition (recipe r2). Absent on frozen r1
    // manifests, which keep their legacy meaning and are never
    // reinterpreted in place.
    delivery: z.enum(['generated', 'original-passthrough', 'generated-over-source']).optional(),
    format: z.enum(['avif', 'webp']),
    height: z.number().int().min(1).max(16384),
    path: z.string().regex(/^[0-9a-f]{64}\.(avif|webp)$/),
    // Pass-through tiers reuse validated source bytes, so no ladder
    // quality applies; generated tiers always carry their encode quality.
    quality: z.union([z.literal(70), z.literal(65), z.literal(60), z.literal(55), z.null()]),
    requestedWidth: z.number().int().min(1).max(16384),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().min(1).max(16384),
  })
  .strict()
  .superRefine((tier, context) => {
    if (tier.path !== `${tier.sha256}.${tier.format}`) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'path must bind the output hash and format' });
    }
    if (tier.contentType !== `image/${tier.format}`) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'content type must match the format' });
    }
    if (tier.width !== tier.actualWidth) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'width must equal the encoded width' });
    }
    if (tier.delivery === 'original-passthrough' && tier.quality !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'pass-through tiers carry no encode quality' });
    }
    if (
      (tier.delivery === 'generated' || tier.delivery === 'generated-over-source') &&
      tier.quality === null
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'generated tiers must carry their encode quality' });
    }
  });

export const PilotManifestSchema = z
  .object({
    assetId: z.string().min(1).max(128),
    createdAt: z.string().datetime({ offset: true }),
    encoder: z
      .object({
        libvipsVersion: z.string().min(1),
        name: z.literal('sharp'),
        sharpVersion: z.string().min(1),
      })
      .strict(),
    merchantId: z.string().uuid(),
    policyVersion: z.literal(PILOT_POLICY_VERSION),
    recipeId: z.string().min(1).max(64),
    role: z.enum(['logo', 'product', 'hero']),
    schemaVersion: z.literal(PILOT_SCHEMA_VERSION),
    source: z
      .object({
        bytes: z.number().int().min(1),
        format: z.string().min(1),
        orientedHeight: z.number().int().min(1).max(16384),
        orientedWidth: z.number().int().min(1).max(16384),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    tiers: z.array(TierSchema).min(1).max(24),
  })
  .strict()
  .superRefine((manifest, context) => {
    const expected = new Set();
    for (const width of TIERS[manifest.role] ?? []) {
      for (const format of ['avif', 'webp']) {
        expected.add(`${width}:${format}`);
      }
    }
    const seen = new Set();
    for (const tier of manifest.tiers) {
      const key = `${tier.requestedWidth}:${tier.format}`;
      if (!expected.has(key) || seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tier "${key}" is unexpected or duplicated`,
        });
      }
      seen.add(key);
    }
    if (seen.size !== expected.size) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tiers must cover the full role ladder exactly once',
      });
    }
    // Never-larger invariants hold only where a disposition is recorded;
    // legacy tiers without one are exempt (frozen r1 keeps its meaning).
    for (const tier of manifest.tiers) {
      if (tier.delivery === undefined) {
        continue;
      }
      const key = `${tier.requestedWidth}:${tier.format}`;
      if (tier.delivery === 'generated' && tier.bytes > manifest.source.bytes) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tier "${key}" claims generated delivery above the source bytes`,
        });
      }
      if (
        tier.delivery === 'generated-over-source' &&
        (tier.bytes <= manifest.source.bytes || tier.format === manifest.source.format)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tier "${key}" claims an over-source limitation that does not hold`,
        });
      }
      if (tier.delivery === 'original-passthrough') {
        const matchesSource =
          tier.bytes === manifest.source.bytes &&
          tier.sha256 === manifest.source.sha256 &&
          tier.width === manifest.source.orientedWidth &&
          tier.height === manifest.source.orientedHeight &&
          tier.format === manifest.source.format;
        if (!matchesSource) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `tier "${key}" pass-through must reuse the validated source bytes, dimensions, and codec`,
          });
        }
      }
    }
  });

export function parsePilotManifest(value) {
  const parsed = PilotManifestSchema.safeParse(value);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => issue.message),
      ok: false,
    };
  }
  return { manifest: parsed.data, ok: true };
}

async function defaultFsync(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function generationDir(outputRoot, generationId) {
  if (!/^[0-9a-f]{64}$/.test(generationId)) {
    throw new PilotManifestError('bad-request', 'unsafe generation id');
  }
  return join(outputRoot, 'generations', generationId);
}

export async function loadGeneration(outputRoot, generationId) {
  const dir = generationDir(outputRoot, generationId);
  const text = await readFile(join(dir, 'manifest.json'), 'utf8').catch(() => {
    throw new PilotManifestError('generation-missing', 'generation is not published');
  });
  let parsed;
  try {
    parsed = parsePilotManifest(JSON.parse(text));
  } catch {
    throw new PilotManifestError('generation-corrupt', 'manifest is not valid JSON');
  }
  if (!parsed.ok) {
    throw new PilotManifestError(
      'generation-corrupt',
      `manifest invalid (${parsed.issues.join('; ')})`
    );
  }
  const files = new Map();
  for (const tier of parsed.manifest.tiers) {
    if (files.has(tier.path)) {
      continue;
    }
    const bytes = await readFile(join(dir, tier.path)).catch(() => {
      throw new PilotManifestError('generation-corrupt', `output missing: ${tier.path}`);
    });
    if (bytes.length !== tier.bytes) {
      throw new PilotManifestError('generation-corrupt', `byte size changed: ${tier.path}`);
    }
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== tier.sha256) {
      throw new PilotManifestError('generation-corrupt', `output hash mismatch: ${tier.path}`);
    }
    // Keep the validated buffers so consumers embed them without a reread
    // (a reread can race replacement bytes under a valid hash).
    files.set(tier.path, bytes);
  }
  return { dir, files, manifest: parsed.manifest };
}

export async function commitGeneration({
  deps = {},
  files,
  generationId,
  job,
  manifest,
  outputRoot,
  stagingDir,
}) {
  const rename = deps.rename ?? fsRename;
  const fsyncFile = deps.fsyncFile ?? defaultFsync;
  const fsyncDir = deps.fsyncDir ?? defaultFsync;
  const parsed = parsePilotManifest(manifest);
  if (!parsed.ok) {
    throw new PilotManifestError('manifest-invalid', parsed.issues.join('; '));
  }
  const valid = parsed.manifest;
  if (
    valid.merchantId !== job.merchantId ||
    valid.assetId !== job.assetId ||
    valid.role !== job.role ||
    valid.source.sha256 !== job.expectedSha256
  ) {
    throw new PilotManifestError('manifest-mismatch', 'manifest does not match the validated job');
  }
  // Every manifest tier needs a staged file with identical bytes.
  const stagedByName = new Map(files.map((file) => [file.name, file.from]));
  const uniquePaths = [...new Set(valid.tiers.map((tier) => tier.path))];
  for (const name of uniquePaths) {
    const from = stagedByName.get(name);
    if (!from) {
      throw new PilotManifestError('staged-file-mismatch', `missing staged file: ${name}`);
    }
    const tier = valid.tiers.find((entry) => entry.path === name);
    const bytes = await readFile(from).catch(() => {
      throw new PilotManifestError('staged-file-mismatch', `cannot read staged file: ${name}`);
    });
    if (
      bytes.length !== tier.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== tier.sha256
    ) {
      throw new PilotManifestError('staged-file-mismatch', `staged bytes differ: ${name}`);
    }
  }
  const expectedId = generationIdFor({
    encoderIdentity: valid.encoder,
    job,
    recipeId: valid.recipeId,
    sourceSha256: job.expectedSha256,
  });
  if (expectedId !== generationId) {
    throw new PilotManifestError(
      'generation-misbound',
      'generation id does not match the requested identity'
    );
  }
  const dir = generationDir(outputRoot, generationId);
  const exists = await lstat(dir)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    // Never overwrite: reuse only after full validation AND a complete
    // identity comparison with the requested generation.
    const loaded = await loadGeneration(outputRoot, generationId);
    const sameEncoder =
      loaded.manifest.encoder.name === valid.encoder.name &&
      loaded.manifest.encoder.sharpVersion === valid.encoder.sharpVersion &&
      loaded.manifest.encoder.libvipsVersion === valid.encoder.libvipsVersion;
    if (
      loaded.manifest.merchantId !== valid.merchantId ||
      loaded.manifest.assetId !== valid.assetId ||
      loaded.manifest.role !== valid.role ||
      loaded.manifest.source.sha256 !== valid.source.sha256 ||
      loaded.manifest.recipeId !== valid.recipeId ||
      !sameEncoder
    ) {
      throw new PilotManifestError(
        'generation-misbound',
        'existing generation identity does not match the requested generation'
      );
    }
    await removeOwnedStaging(outputRoot, stagingDir).catch(() => {});
    return { durability: 'synced', path: dir, reused: true };
  }
  const commitDir = join(stagingDir, 'commit');
  await (deps.mkdir ?? mkdir)(commitDir, { recursive: true });
  for (const name of uniquePaths) {
    await rename(stagedByName.get(name), join(commitDir, name));
  }
  await writeFile(join(commitDir, 'manifest.json'), `${JSON.stringify(valid, null, 2)}\n`);
  let durability = 'synced';
  try {
    for (const name of [...uniquePaths, 'manifest.json']) {
      await fsyncFile(join(commitDir, name));
    }
    await fsyncDir(commitDir);
  } catch {
    // Atomic visibility still holds via rename; power-loss durability is
    // honestly reported instead of claimed on this filesystem.
    durability = 'sync-unsupported';
  }
  await (deps.mkdir ?? mkdir)(join(outputRoot, 'generations'), { recursive: true });
  await rename(commitDir, dir);
  try {
    await fsyncDir(join(outputRoot, 'generations'));
  } catch {
    durability = 'sync-unsupported';
  }
  return { durability, path: dir, reused: false };
}
