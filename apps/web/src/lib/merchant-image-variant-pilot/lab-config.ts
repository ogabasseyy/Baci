import 'server-only';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { PilotInventoryBinding } from '@/schemas/merchant-image-variant-pilot';
import {
  buildLabIndex,
  lookupPilotTiers,
  type PilotBindingStatus,
  type PilotLabIndex,
} from './lab-index';
import { assertSnapshotMatchesSource } from './lab-source-verify';
import { parsePilotInventory } from './pilot-inventory';

export const PILOT_LAB_FLAG = 'BACI_IMAGE_PILOT_LAB';
export const PILOT_LAB_BASE_URL = '/__pilot';

export function isPilotLabEnabled(): boolean {
  return process.env[PILOT_LAB_FLAG] === '1';
}

export interface PilotLabConfig {
  baseUrl: string;
  bindings: readonly PilotInventoryBinding[];
  index: PilotLabIndex;
  originalUrlFor: (slot: {
    merchantId: string;
    slotId: string;
  }) => string | null;
  // Absolute staged file paths (tiers + originals) with their verified
  // hashes. The route layer re-stats on the cached-config path and only
  // re-hashes when size/mtime changed, so deleted or drifted files fail
  // closed instead of serving URLs for 404s or swapped bytes.
  stagedPaths: readonly { path: string; sha256: string }[];
  statuses: PilotBindingStatus[];
}

interface InventoryRecord {
  assetId: string;
  merchantId: string;
  role: string;
  sha256: string;
  slot: string;
  sourcePath: string;
  url: string;
}

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

function originalFileName(
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

async function readVerifiedSnapshot(
  inputRoot: string,
  sourcePath: string,
  expectedSha256: string
): Promise<Buffer> {
  const realRoot = await realpath(inputRoot);
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
  const bytes = await readFile(real);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expectedSha256) {
    throw new Error(
      'merchant image pilot: snapshot bytes differ from the frozen hash'
    );
  }
  return bytes;
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
  await writeFile(input.destPath, bytes);
}

async function destMatches(destPath: string, bytes: Buffer): Promise<boolean> {
  const existing = await readFile(destPath).catch(() => null);
  return (
    existing !== null &&
    existing.length === bytes.length &&
    existing.equals(bytes)
  );
}

export async function loadLabConfig(
  input: {
    acceptances: readonly unknown[];
    inputRoot: string;
    inventoryRecords: readonly InventoryRecord[];
    outputRoot: string;
    publicDir: string;
  },
  options?: { stage?: boolean }
): Promise<PilotLabConfig> {
  if (!isPilotLabEnabled()) {
    throw new Error('merchant image pilot: refusing to load outside lab mode');
  }
  // Read-only unless explicitly asked: staging runs exclusively in the
  // pre-start CLI, so a GET (or any future direct caller that forgets the
  // option) never writes to disk. The route layer fails closed when
  // staged bytes are missing or drifted.
  const baseUrl = PILOT_LAB_BASE_URL;
  const parsed = parsePilotInventory(
    input.inventoryRecords.map((record) => ({
      assetId: record.assetId,
      merchantId: record.merchantId,
      originalUrl: record.url,
      role: record.role,
      slotId: record.slot,
      sourceSha256: record.sha256,
    }))
  );
  if (!parsed.ok) {
    throw new Error(
      `merchant image pilot: invalid inventory (${parsed.issues.join('; ')})`
    );
  }
  const { diagnostics, index, statuses } = await buildLabIndex({
    acceptances: input.acceptances,
    bindings: parsed.bindings,
    outputRoot: input.outputRoot,
  });
  // Malformed or conflicting acceptances must fail the load, not shrink
  // it: silently converting them into missing-acceptance statuses lets
  // pilot:stage print ok:true for a subset the strict offline preflight
  // would reject, and request-time config would diverge the same way.
  if (diagnostics.length > 0) {
    throw new Error(
      `merchant image pilot: invalid acceptances (${diagnostics.join('; ')})`
    );
  }
  // Stage approved derivatives plus original snapshots under the lab base
  // URL so both comparison arms serve bytes from the same lab asset origin.
  // This runs once at lab setup (pre-start CLI with stage: true), never on
  // a shopper request. Staging must complete BEFORE `next start`: files
  // added to public/ after the server starts are not served. Request-time
  // loads are read-only, so the route layer fails closed when staged
  // bytes go missing instead of serving URLs for 404s, and preflight's
  // served-byte checks verify servability end to end.
  const stagedOriginals = new Map<string, string>();
  const stagedPaths: { path: string; sha256: string }[] = [];
  for (const status of statuses) {
    if (status.status !== 'accepted' || !status.generationId) {
      continue;
    }
    const record = input.inventoryRecords.find(
      (entry) =>
        entry.merchantId === status.binding.merchantId &&
        entry.assetId === status.binding.assetId
    );
    if (!record) {
      continue;
    }
    const generationStage = join(
      input.publicDir,
      '__pilot',
      status.generationId
    );
    // Read-only loads still validate every input (manifests, hashes,
    // snapshots) but write nothing; stagedPaths lets the caller verify.
    const shouldStage = options?.stage === true;
    if (shouldStage) {
      await mkdir(generationStage, { recursive: true });
    }
    const tiers = lookupPilotTiers(index, {
      assetId: status.binding.assetId,
      merchantId: status.binding.merchantId,
      role: status.binding.role,
      sourceSha256: status.binding.sourceSha256,
    });
    for (const tier of tiers ?? []) {
      const tierDest = join(generationStage, tier.fileName);
      if (shouldStage) {
        await stageVerifiedTier({
          destPath: tierDest,
          expectedBytes: tier.bytes,
          expectedSha256: tier.sha256,
          sourcePath: join(
            input.outputRoot,
            'generations',
            status.generationId,
            tier.fileName
          ),
        });
      }
      stagedPaths.push({ path: tierDest, sha256: tier.sha256 });
    }
    const originalsStage = join(input.publicDir, '__pilot', 'originals');
    if (shouldStage) {
      await mkdir(originalsStage, { recursive: true });
    }
    const snapshot = await readVerifiedSnapshot(
      input.inputRoot,
      record.sourcePath,
      status.binding.sourceSha256
    );
    if (!status.source) {
      throw new Error(
        'merchant image pilot: accepted binding is missing manifest source facts'
      );
    }
    await assertSnapshotMatchesSource(
      snapshot,
      status.source,
      `${status.binding.merchantId}/${status.binding.slotId}`
    );
    // Name from the verified format, not the inventory filename: the
    // assertion above proved the snapshot decodes as status.source.format.
    const fileName = originalFileName(status.binding, status.source.format);
    const originalDest = join(originalsStage, fileName);
    if (shouldStage && !(await destMatches(originalDest, snapshot))) {
      await writeFile(originalDest, snapshot);
    }
    stagedPaths.push({
      path: originalDest,
      sha256: status.binding.sourceSha256,
    });
    stagedOriginals.set(
      `${status.binding.merchantId}/${status.binding.slotId}`,
      `${baseUrl}/originals/${fileName}`
    );
  }
  return {
    baseUrl,
    bindings: parsed.bindings,
    index,
    originalUrlFor: (slot) =>
      stagedOriginals.get(`${slot.merchantId}/${slot.slotId}`) ?? null,
    stagedPaths,
    statuses,
  };
}
