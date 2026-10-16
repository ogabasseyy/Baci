import 'server-only';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { PilotInventoryBinding } from '@/schemas/merchant-image-variant-pilot';
import { readUpToBytes } from './lab-config-stage-io-read';

// Mirror of MAX_INPUT_BYTES in
// infra/cdn-transformer/pilot/constants.mjs: the staged snapshot read
// below must bound the same cap the generator enforces. Pinned by
// lab-config-stage-read.test.mjs against the original; web runtime code
// must not import infra directly.
const MAX_STAGED_SNAPSHOT_BYTES = 10 * 1024 * 1024;

// Staged-original suffixes must describe the bytes: Next serves public/
// files with a suffix-derived MIME type, and the served gate pins the
// response type to that same suffix. The inventory filename is
// operator-controlled and may lie, so the suffix comes from the
// decode-verified manifest format. Formats outside the served gate's
// known image set fail closed: there is no correct suffix for them.
const STAGED_ORIGINAL_EXTENSION_FOR_FORMAT: Record<string, string> = {
  avif: '.avif',
  gif: '.gif',
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  svg: '.svg',
  webp: '.webp',
};

export function originalFileName(
  binding: PilotInventoryBinding,
  sourceFormat: string
): string {
  const extension =
    STAGED_ORIGINAL_EXTENSION_FOR_FORMAT[sourceFormat.toLowerCase()];
  if (!extension) {
    throw new Error(
      `merchant image pilot: cannot stage an original with format "${sourceFormat}" (no servable suffix)`
    );
  }
  return `${binding.merchantId}-${binding.assetId}${extension}`;
}

export async function readVerifiedSnapshot(
  inputRoot: string,
  sourcePath: string,
  expectedSha256: string
): Promise<Buffer> {
  // Basename-free error like the snapshot catch below: the raw ENOENT
  // carries the absolute operator path, and loader errors can surface in
  // route error output on a shared host with the lab flag on.
  const realRoot = await realpath(inputRoot).catch(() => {
    throw new Error(
      'merchant image pilot: snapshot input root is not accessible'
    );
  });
  const joined = join(realRoot, sourcePath);
  if (joined !== realRoot && !joined.startsWith(realRoot + sep)) {
    throw new Error(
      'merchant image pilot: snapshot path escapes the input root'
    );
  }
  const real = await realpath(joined).catch(() => {
    throw new Error('merchant image pilot: snapshot is not accessible');
  });
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    throw new Error(
      'merchant image pilot: snapshot path escapes the input root'
    );
  }
  // Bounded read: never allocate an unbounded file into memory.
  // Past-cap inputs are rejected instead of hashing a truncation.
  const { bytes, truncated } = await readUpToBytes(
    real,
    MAX_STAGED_SNAPSHOT_BYTES
  );
  if (truncated) {
    throw new Error(
      `merchant image pilot: snapshot exceeds the ${MAX_STAGED_SNAPSHOT_BYTES}-byte input limit`
    );
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expectedSha256) {
    throw new Error(
      'merchant image pilot: snapshot bytes differ from the frozen hash'
    );
  }
  return bytes;
}
