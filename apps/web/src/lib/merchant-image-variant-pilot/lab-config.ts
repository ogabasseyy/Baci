import 'server-only';
import { join } from 'node:path';
import type { PilotInventoryBinding } from '@/schemas/merchant-image-variant-pilot';
import {
  ensureStageDir,
  originalFileName,
  readVerifiedSnapshot,
  stageVerifiedTier,
  writeStagedBytesIfChanged,
} from './lab-config-stage-io';
import { reconcileStagedTree } from './lab-config-stage-reconcile';
import { resolveLabGenerationDir } from './lab-generation-dir';
import {
  buildLabIndex,
  lookupPilotTiers,
  type PilotBindingStatus,
  type PilotLabIndex,
} from './lab-index';
import {
  assertSnapshotMatchesSource,
  snapshotFormat,
} from './lab-source-verify';
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
  // Paths removed by restage reconciliation, relative to the __pilot
  // stage root. Present only on staging loads: a rerun after the
  // inventory changed removes previous generations/originals instead of
  // leaving stale merchant bytes reachable.
  reconciled?: readonly string[];
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
  // Read-only loads still validate every input (manifests, hashes,
  // snapshots) but write nothing; stagedPaths lets the caller verify.
  const shouldStage = options?.stage === true;
  const pilotStage = shouldStage
    ? await ensureStageDir(input.publicDir, '__pilot')
    : join(input.publicDir, '__pilot');
  for (const status of statuses) {
    const record = input.inventoryRecords.find(
      (entry) =>
        entry.merchantId === status.binding.merchantId &&
        entry.assetId === status.binding.assetId
    );
    if (!record) {
      continue;
    }
    // Acceptance gates derivative activation only. The verified original
    // stages for every valid inventory binding so out-of-coverage slots
    // render the real control instead of a not-optimized row.
    const generationId =
      status.status === 'accepted' ? status.generationId : undefined;
    if (generationId) {
      // Re-confine at stage time: index-build verified this entry, but
      // the bytes staged here must come from inside the output tree now.
      await resolveLabGenerationDir(input.outputRoot, generationId);
      const generationStage = shouldStage
        ? await ensureStageDir(pilotStage, generationId)
        : join(pilotStage, generationId);
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
              generationId,
              tier.fileName
            ),
            stageRoot: pilotStage,
          });
        }
        stagedPaths.push({ path: tierDest, sha256: tier.sha256 });
      }
    }
    const originalsStage = shouldStage
      ? await ensureStageDir(pilotStage, 'originals')
      : join(pilotStage, 'originals');
    let snapshot: Buffer;
    try {
      snapshot = await readVerifiedSnapshot(
        input.inputRoot,
        record.sourcePath,
        status.binding.sourceSha256
      );
    } catch (error) {
      // Unaccepted bytes that fail hash verification stage nothing: the
      // slot keeps its not-optimized row instead of a control the freeze
      // cannot vouch for. Only the hash failure on an unaccepted binding
      // is skippable — accepted claims, inaccessible roots, escapes, and
      // over-cap inputs stay loud.
      if (
        !generationId &&
        error instanceof Error &&
        error.message ===
          'merchant image pilot: snapshot bytes differ from the frozen hash'
      ) {
        continue;
      }
      throw error;
    }
    let format: string;
    if (generationId) {
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
      format = status.source.format;
    } else {
      // No accepted manifest to name the format: decode it from the
      // hash-verified bytes themselves, never from an unaccepted claim.
      format = await snapshotFormat(snapshot);
    }
    const fileName = originalFileName(status.binding, format);
    const originalDest = join(originalsStage, fileName);
    if (shouldStage) {
      await writeStagedBytesIfChanged(pilotStage, originalDest, snapshot);
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
  // Reconcile only staging loads: read-only route loads must never write.
  const reconciled = shouldStage
    ? await reconcileStagedTree({
        generationIds: statuses.flatMap((status) =>
          status.status === 'accepted' && status.generationId
            ? [status.generationId]
            : []
        ),
        pilotStage,
        stagedFiles: stagedPaths.map((entry) => entry.path),
      })
    : undefined;
  return {
    baseUrl,
    bindings: parsed.bindings,
    index,
    originalUrlFor: (slot) =>
      stagedOriginals.get(`${slot.merchantId}/${slot.slotId}`) ?? null,
    stagedPaths,
    ...(reconciled === undefined ? {} : { reconciled }),
    statuses,
  };
}
