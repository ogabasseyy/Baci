// Offline staged stage: staged derivatives and the staged original hash
// identically to their committed and frozen bytes.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_INPUT_BYTES } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { stagedOriginalName } from './merchant-image-pilot-preflight-records.mjs';
import {
  fail,
  pass,
  readUpToBytes,
  sha256Hex,
} from './merchant-image-pilot-preflight-shared.mjs';

export async function checkBindingStaged({
  acceptance,
  checks,
  failures,
  manifest,
  name,
  options,
  record,
}) {
  for (const tier of manifest.tiers) {
    // Bounded by the claimed size, like the committed tier read: a huge
    // staged file rejects without allocating the whole file.
    let staged;
    let truncatedTier = false;
    try {
      ({ bytes: staged, truncated: truncatedTier } = await readUpToBytes(
        join(options.publicDir, '__pilot', acceptance.generationId, tier.path),
        tier.bytes
      ));
    } catch {
      fail(
        checks,
        failures,
        `${name}:staged`,
        `staged derivative missing: ${tier.path}`
      );
      return false;
    }
    if (
      truncatedTier ||
      staged.length !== tier.bytes ||
      sha256Hex(staged) !== tier.sha256
    ) {
      fail(
        checks,
        failures,
        `${name}:staged`,
        `staged derivative hash mismatch: ${tier.path}`
      );
      return false;
    }
  }
  const originalName = stagedOriginalName(
    { assetId: record.assetId, merchantId: record.merchantId },
    manifest.source.format
  );
  // Bounded by the manifest source bytes: the staged original must hash
  // to the frozen snapshot, so anything larger already fails.
  let stagedOriginal;
  let truncatedOriginal = false;
  try {
    ({ bytes: stagedOriginal, truncated: truncatedOriginal } =
      await readUpToBytes(
        join(options.publicDir, '__pilot', 'originals', originalName),
        manifest.source.bytes
      ));
  } catch {
    fail(
      checks,
      failures,
      `${name}:staged`,
      `staged original missing: ${originalName}`
    );
    return false;
  }
  if (truncatedOriginal || sha256Hex(stagedOriginal) !== record.sha256) {
    fail(
      checks,
      failures,
      `${name}:staged`,
      `staged original hash mismatch: ${originalName}`
    );
    return false;
  }
  pass(checks, `${name}:staged`);
  return true;
}

// Filler pins for the served phase, keyed by served path. Fillers have no
// acceptance anchor (their hash pins live in the app's build/boot gate,
// which fails the origin itself when they drift), so offline blesses the
// on-disk bytes and the served gate detects swaps after this point.
// Best-effort by design: an absent dir, an overfull dir, or an unreadable
// file simply yields no entry, and the served gate then fails closed on
// any filler URL it meets instead of comparing two mutable views.
export async function collectFillerHashes({ publicDir }) {
  const hashes = {};
  let entries;
  try {
    entries = await readdir(join(publicDir, '__pilot', 'fillers'));
  } catch {
    return hashes;
  }
  // Legit dirs hold three pinned files; past this the dir is planted or
  // corrupt, and blessing nothing fails the served filler URLs loudly.
  if (entries.length > 64) {
    return hashes;
  }
  for (const file of entries) {
    let read;
    try {
      read = await readUpToBytes(
        join(publicDir, '__pilot', 'fillers', file),
        MAX_INPUT_BYTES
      );
    } catch {
      continue;
    }
    if (!read.truncated) {
      hashes[`/__pilot/fillers/${file}`] = sha256Hex(read.bytes);
    }
  }
  return hashes;
}
