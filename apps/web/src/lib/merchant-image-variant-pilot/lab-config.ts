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

function originalFileName(
  binding: PilotInventoryBinding,
  sourcePath: string
): string {
  const segments = sourcePath.split('/');
  const base = segments[segments.length - 1] ?? '';
  const extension = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
  const safeExtension = /^\.[a-z0-9]{1,5}$/i.test(extension)
    ? extension.toLowerCase()
    : '';
  return `${binding.merchantId}-${binding.assetId}${safeExtension}`;
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
  await writeFile(input.destPath, bytes);
}

export async function loadLabConfig(input: {
  acceptances: readonly unknown[];
  inputRoot: string;
  inventoryRecords: readonly InventoryRecord[];
  outputRoot: string;
  publicDir: string;
}): Promise<PilotLabConfig> {
  if (!isPilotLabEnabled()) {
    throw new Error('merchant image pilot: refusing to load outside lab mode');
  }
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
  const { index, statuses } = await buildLabIndex({
    acceptances: input.acceptances,
    bindings: parsed.bindings,
    outputRoot: input.outputRoot,
  });
  // Stage approved derivatives plus original snapshots under the lab base
  // URL so both comparison arms serve bytes from the same lab asset origin.
  // This runs once at lab setup, never on a shopper request.
  const stagedOriginals = new Map<string, string>();
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
    await mkdir(generationStage, { recursive: true });
    const tiers = lookupPilotTiers(index, {
      assetId: status.binding.assetId,
      merchantId: status.binding.merchantId,
      role: status.binding.role,
      sourceSha256: status.binding.sourceSha256,
    });
    for (const tier of tiers ?? []) {
      await stageVerifiedTier({
        destPath: join(generationStage, tier.fileName),
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
    const originalsStage = join(input.publicDir, '__pilot', 'originals');
    await mkdir(originalsStage, { recursive: true });
    const fileName = originalFileName(status.binding, record.sourcePath);
    const snapshot = await readVerifiedSnapshot(
      input.inputRoot,
      record.sourcePath,
      status.binding.sourceSha256
    );
    await writeFile(join(originalsStage, fileName), snapshot);
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
    statuses,
  };
}
