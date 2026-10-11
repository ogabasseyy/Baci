// Offline staged stage: staged derivatives and the staged original hash
// identically to their committed and frozen bytes.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// Committed filler pins, parsed from the app's build/boot gate config:
// the SAME three hashes pilot-public-assets.ts enforces, so preflight
// and the origin can never disagree about what a filler must be. Parsed
// from source (the gate is TypeScript): the FILLERS map shape is the
// contract, and the empty-map guard below fails closed on drift.
const GATE_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'config',
  'pilot-public-assets.ts'
);

export async function loadCommittedFillerPins(configPath = GATE_CONFIG_PATH) {
  const text = await readFile(configPath, 'utf8');
  const blockStart = text.indexOf('const FILLERS');
  const blockEnd = text.indexOf('\n};', blockStart);
  const block =
    blockStart === -1 || blockEnd === -1
      ? ''
      : text.slice(blockStart, blockEnd);
  const pins = {};
  for (const match of block.matchAll(/'([^']+)':\s*'([0-9a-f]{64})'/g)) {
    pins[match[1]] = match[2];
  }
  return pins;
}

// Filler pins for the served phase, keyed by served path. Fillers have no
// acceptance anchor, but their hash pins live in the app's build/boot
// gate — so offline verifies the on-disk bytes against those committed
// pins and records the PIN, never the disk digest: hashing a replacement
// swapped in after the build/startup check would bless the mutable bytes
// and let the served gate pass the same replacement. Best-effort by
// design: an absent dir, an overfull dir, or an unreadable file simply
// yields no entry, and the served gate then fails closed on any filler
// URL it meets instead of comparing two mutable views.
export async function collectFillerHashes({
  checks,
  failures,
  fillerPins,
  publicDir,
}) {
  const hashes = {};
  const seenFailures = failures.length;
  const failed = () => failures.length !== seenFailures;
  const done = () => {
    if (!failed()) {
      pass(checks, 'fillers-pinned');
    }
    return hashes;
  };
  let pins = fillerPins;
  if (!pins) {
    try {
      pins = await loadCommittedFillerPins();
    } catch {
      pins = {};
    }
  }
  if (Object.keys(pins).length === 0) {
    fail(
      checks,
      failures,
      'fillers-pinned',
      'committed filler pins are missing or unreadable'
    );
    return hashes;
  }
  let entries;
  try {
    entries = await readdir(join(publicDir, '__pilot', 'fillers'));
  } catch {
    return done();
  }
  // Legit dirs hold three pinned files; past this the dir is planted or
  // corrupt, and pinning nothing fails the served filler URLs loudly.
  if (entries.length > 64) {
    return done();
  }
  for (const file of entries) {
    const expected = pins[file];
    if (!expected) {
      fail(
        checks,
        failures,
        'fillers-pinned',
        `filler is not in the committed pin set: ${file}`
      );
      continue;
    }
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
      if (sha256Hex(read.bytes) !== expected) {
        fail(
          checks,
          failures,
          'fillers-pinned',
          `filler hash mismatch: ${file}`
        );
        continue;
      }
      hashes[`/__pilot/fillers/${file}`] = expected;
    }
  }
  return done();
}
