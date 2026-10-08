// Verified generation loads for the merchant image pilot: confinement,
// bounded reads, and hash verification. Atomic publication stays in
// manifest-store.mjs, which re-exports loadGeneration.
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_MANIFEST_BYTES } from './constants.mjs';
import { readUpToBytes } from './disk-guards.mjs';
import { PilotManifestError, parsePilotManifest } from './manifest.mjs';

export function generationDir(outputRoot, generationId) {
  if (!/^[0-9a-f]{64}$/.test(generationId)) {
    throw new PilotManifestError('bad-request', 'unsafe generation id');
  }
  return join(outputRoot, 'generations', generationId);
}

export async function loadGeneration(outputRoot, generationId) {
  const dir = generationDir(outputRoot, generationId);
  // A symlinked generation entry is never reusable: lstat succeeds on
  // links, but only a real directory whose canonical path stays beneath
  // generations/ may serve reuse, quality-sheet, or staging reads.
  const stat = await lstat(dir).catch(() => {
    throw new PilotManifestError(
      'generation-missing',
      'generation is not published'
    );
  });
  if (!stat.isDirectory()) {
    throw new PilotManifestError(
      'generation-corrupt',
      'generation entry is not a directory'
    );
  }
  const generationsRoot = join(outputRoot, 'generations');
  const realRoot = await realpath(generationsRoot).catch(() => {
    throw new PilotManifestError(
      'generation-missing',
      'generation is not published'
    );
  });
  if ((await realpath(dir)) !== join(realRoot, generationId)) {
    throw new PilotManifestError(
      'generation-corrupt',
      'generation entry escapes the output root'
    );
  }
  // Bounded like the tier loop below: a corrupted manifest.json replaced
  // with a huge file rejects on size instead of exhausting the operator
  // process before schema validation can run.
  let text;
  try {
    const read = await readUpToBytes(
      join(dir, 'manifest.json'),
      MAX_MANIFEST_BYTES
    );
    if (read.truncated) {
      throw new PilotManifestError(
        'generation-corrupt',
        'manifest exceeds the size ceiling'
      );
    }
    text = read.bytes.toString('utf8');
  } catch (error) {
    if (error instanceof PilotManifestError) {
      throw error;
    }
    throw new PilotManifestError(
      'generation-missing',
      'generation is not published'
    );
  }
  let parsed;
  try {
    parsed = parsePilotManifest(JSON.parse(text));
  } catch {
    throw new PilotManifestError(
      'generation-corrupt',
      'manifest is not valid JSON'
    );
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
    // Bounded by the claimed size: a corrupted tier replaced with a huge
    // file rejects on size without allocating the whole file.
    let bytes;
    try {
      const read = await readUpToBytes(join(dir, tier.path), tier.bytes);
      if (read.truncated) {
        throw new PilotManifestError(
          'generation-corrupt',
          `byte size changed: ${tier.path}`
        );
      }
      bytes = read.bytes;
    } catch (error) {
      if (error instanceof PilotManifestError) {
        throw error;
      }
      throw new PilotManifestError(
        'generation-corrupt',
        `output missing: ${tier.path}`
      );
    }
    if (bytes.length !== tier.bytes) {
      throw new PilotManifestError(
        'generation-corrupt',
        `byte size changed: ${tier.path}`
      );
    }
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== tier.sha256) {
      throw new PilotManifestError(
        'generation-corrupt',
        `output hash mismatch: ${tier.path}`
      );
    }
    // Keep the validated buffers so consumers embed them without a reread
    // (a reread can race replacement bytes under a valid hash).
    files.set(tier.path, bytes);
  }
  return { dir, files, manifest: parsed.manifest };
}
