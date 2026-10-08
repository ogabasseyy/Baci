import 'server-only';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import type { PilotInventoryBinding } from '@/schemas/merchant-image-variant-pilot';

// Mirror of MAX_INPUT_BYTES in
// infra/cdn-transformer/pilot/constants.mjs: the staged snapshot read
// below must bound the same cap the generator enforces. Pinned by
// lab-config-stage-io.test.mjs against the original; web runtime code
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

// Creates a staging directory confined under the public dir: recursive
// mkdir follows symlinks, so a planted __pilot symlink would otherwise
// redirect every staged write outside the lab tree. Returns the
// canonical directory for the per-file confinement below.
export async function ensureStageDir(
  publicDir: string,
  ...segments: string[]
): Promise<string> {
  // Create first, confine after: the public dir itself may not exist
  // yet on a fresh stage, and recursive mkdir builds the chain.
  await mkdir(join(publicDir, ...segments), { recursive: true }).catch(() => {
    throw new Error(
      'merchant image pilot: staged public dir is not accessible'
    );
  });
  const realPublic = await realpath(publicDir);
  const real = await realpath(join(publicDir, ...segments));
  if (real !== realPublic && !real.startsWith(realPublic + sep)) {
    throw new Error(
      'merchant image pilot: staging directory escapes the public dir'
    );
  }
  return real;
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
  // Bounded read: never allocate an unbounded file into memory. Reads
  // loop to EOF-or-cap (a single read may return short) and reject
  // past-cap inputs instead of hashing a truncation.
  const handle = await open(real, 'r');
  try {
    const probe = Buffer.alloc(MAX_STAGED_SNAPSHOT_BYTES + 1);
    let bytesRead = 0;
    let short = false;
    while (bytesRead < probe.length && !short) {
      const chunk = await handle.read(
        probe,
        bytesRead,
        probe.length - bytesRead,
        bytesRead
      );
      bytesRead += chunk.bytesRead;
      short = chunk.bytesRead === 0;
    }
    if (bytesRead > MAX_STAGED_SNAPSHOT_BYTES) {
      throw new Error(
        `merchant image pilot: snapshot exceeds the ${MAX_STAGED_SNAPSHOT_BYTES}-byte input limit`
      );
    }
    const bytes = Buffer.from(probe.subarray(0, bytesRead));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== expectedSha256) {
      throw new Error(
        'merchant image pilot: snapshot bytes differ from the frozen hash'
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

// Writes staged bytes so a planted symlink can neither divert them nor
// survive as the served file: the parent must confine under the stage
// root, a symlink at the destination is refused (even when its target
// coincidentally holds identical bytes), and the file is created
// exclusively so a symlink swapped in mid-write fails instead of
// redirecting the write outside the lab tree.
export async function writeStagedFile(
  stageRoot: string,
  destPath: string,
  bytes: Buffer
): Promise<void> {
  const realParent = await realpath(dirname(destPath)).catch(() => {
    throw new Error(
      'merchant image pilot: staging destination is not accessible'
    );
  });
  if (realParent !== stageRoot && !realParent.startsWith(stageRoot + sep)) {
    throw new Error(
      'merchant image pilot: staging destination escapes the stage root'
    );
  }
  const existing = await lstat(destPath).catch(() => null);
  if (existing?.isSymbolicLink()) {
    throw new Error(
      'merchant image pilot: staging destination is a symlink; refusing to write through it'
    );
  }
  if (existing) {
    await unlink(destPath);
  }
  const handle = await open(destPath, 'wx').catch(() => {
    throw new Error(
      'merchant image pilot: staging destination appeared mid-write; refusing to overwrite'
    );
  });
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

// Stages one approved tier by reading it once, validating the captured
// bytes against the verified size/hash, and writing that same buffer. A
// copy-after-verify would re-read the file and could stage swapped bytes.
// Destinations that already hold the verified bytes are left untouched, so
// the pre-start stage step is idempotent and request-time loads never churn
// post-start mtimes.
export async function stageVerifiedTier(input: {
  destPath: string;
  expectedBytes: number;
  expectedSha256: string;
  sourcePath: string;
  stageRoot: string;
}): Promise<void> {
  const bytes = await readFile(input.sourcePath);
  if (bytes.length !== input.expectedBytes) {
    throw new Error(
      'merchant image pilot: tier byte size changed before staging'
    );
  }
  if (
    createHash('sha256').update(bytes).digest('hex') !== input.expectedSha256
  ) {
    throw new Error('merchant image pilot: tier hash mismatch before staging');
  }
  if (await destMatches(input.destPath, bytes)) {
    return;
  }
  await writeStagedFile(input.stageRoot, input.destPath, bytes);
}

// Bytes-in-hand variant of the tier staging below: skips the write when
// the destination already holds the verified bytes (idempotent stage,
// no post-start mtime churn), otherwise confines and writes as above.
export async function writeStagedBytesIfChanged(
  stageRoot: string,
  destPath: string,
  bytes: Buffer
): Promise<void> {
  if (await destMatches(destPath, bytes)) {
    return;
  }
  await writeStagedFile(stageRoot, destPath, bytes);
}

async function destMatches(destPath: string, bytes: Buffer): Promise<boolean> {
  // A symlink never "matches": skipping the write would leave the link
  // in place and serve whatever it points at.
  const info = await lstat(destPath).catch(() => null);
  if (!info || info.isSymbolicLink()) {
    return false;
  }
  const existing = await readFile(destPath).catch(() => null);
  return (
    existing !== null &&
    existing.length === bytes.length &&
    existing.equals(bytes)
  );
}
