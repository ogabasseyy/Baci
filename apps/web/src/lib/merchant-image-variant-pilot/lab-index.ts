import 'server-only';
import { join } from 'node:path';
import type {
  PilotAcceptance,
  PilotInventoryBinding,
  PilotManifest,
} from '@/schemas/merchant-image-variant-pilot';
import {
  matchPilotAcceptance,
  PILOT_RECIPE_ID,
  parsePilotAcceptance,
  parsePilotManifest,
} from '@/schemas/merchant-image-variant-pilot';
import { readBoundedLabJson } from './lab-bounded-json';
import { indexKey } from './lab-index-lookup';
import {
  verifyGenerationBinding,
  verifyOutputHashes,
} from './lab-index-verify';

export type PilotTierDelivery =
  | 'generated'
  | 'original-passthrough'
  | 'generated-over-source'
  | 'legacy';

export interface ApprovedPilotTier {
  actualWidth: number;
  bytes: number;
  contentType: 'image/avif' | 'image/webp';
  // Delivery disposition: 'generated'/'original-passthrough' are capped
  // at source bytes; 'generated-over-source' is the explicit over-source
  // exception. Unrecorded r1 tiers surface as 'legacy' (unguarded).
  delivery: PilotTierDelivery;
  fileName: string;
  format: 'avif' | 'webp';
  generationId: string;
  height: number;
  // Pass-through tiers reuse validated source bytes, so no ladder quality
  // applies; generated tiers always carry their encode quality.
  quality: 70 | 65 | 60 | 55 | null;
  requestedWidth: number;
  sha256: string;
  width: number;
}

export interface PilotLabIndex {
  readonly entries: Readonly<Record<string, readonly ApprovedPilotTier[]>>;
}

export type PilotBindingStatusCode =
  | 'accepted'
  | 'missing-acceptance'
  | 'missing-manifest'
  | 'invalid-manifest'
  | 'binding-mismatch'
  | 'stale-recipe'
  | 'rejected'
  | 'acceptance-mismatch'
  | 'hash-mismatch';

export interface PilotBindingStatus {
  binding: PilotInventoryBinding;
  detail?: string;
  generationId?: string;
  // Manifest source facts for the accepted generation. The config loader
  // verifies these against the decoded snapshot before staging, so a
  // manifest can never claim bytes, a format, or dimensions the frozen
  // snapshot does not demonstrate.
  source?: {
    bytes: number;
    format: string;
    orientedHeight: number;
    orientedWidth: number;
  };
  status: PilotBindingStatusCode;
}

const GENERATION_ID_PATTERN = /^[0-9a-f]{64}$/;

function sameAcceptance(
  left: PilotAcceptance,
  right: PilotAcceptance
): boolean {
  // Positional: binding pins each hash to one rung, so swapped multisets
  // are conflicting verdicts, not idempotent duplicates.
  return (
    left.generationId === right.generationId &&
    left.verdict === right.verdict &&
    left.recipeId === right.recipeId &&
    left.sourceSha256 === right.sourceSha256 &&
    left.outputHashes.length === right.outputHashes.length &&
    left.outputHashes.every((hash, index) => hash === right.outputHashes[index])
  );
}

export { lookupPilotTiers, selectPilotTier } from './lab-index-lookup';

function deepFreezeIndex(index: PilotLabIndex): PilotLabIndex {
  for (const tiers of Object.values(index.entries)) {
    for (const tier of tiers) {
      Object.freeze(tier);
    }
    Object.freeze(tiers);
  }
  Object.freeze(index.entries);
  return Object.freeze(index);
}

export async function buildLabIndex(input: {
  bindings: readonly PilotInventoryBinding[];
  acceptances: readonly unknown[];
  outputRoot: string;
}): Promise<{
  diagnostics: string[];
  index: PilotLabIndex;
  statuses: PilotBindingStatus[];
}> {
  const entries: Record<string, readonly ApprovedPilotTier[]> = {};
  const statuses: PilotBindingStatus[] = [];
  const diagnostics: string[] = [];
  const acceptanceByAsset = new Map<string, PilotAcceptance>();
  const conflictingKeys = new Set<string>();
  input.acceptances.forEach((acceptance, position) => {
    const parsed = parsePilotAcceptance(acceptance);
    if (!parsed.ok) {
      diagnostics.push(
        `acceptance[${position}] invalid (${parsed.issues.join('; ')})`
      );
      return;
    }
    const key = `${parsed.record.merchantId}/${parsed.record.assetId}`;
    const prior = acceptanceByAsset.get(key);
    if (!prior) {
      acceptanceByAsset.set(key, parsed.record);
      return;
    }
    if (sameAcceptance(prior, parsed.record)) {
      return;
    }
    conflictingKeys.add(key);
    diagnostics.push(
      `duplicate acceptances for "${key}" conflict; refusing to activate either`
    );
  });

  for (const binding of input.bindings) {
    const key = `${binding.merchantId}/${binding.assetId}`;
    if (conflictingKeys.has(key)) {
      statuses.push({
        binding,
        detail: 'conflicting duplicate acceptances',
        status: 'acceptance-mismatch',
      });
      continue;
    }
    const record = acceptanceByAsset.get(key);
    if (!record) {
      statuses.push({ binding, status: 'missing-acceptance' });
      continue;
    }
    if (!GENERATION_ID_PATTERN.test(record.generationId)) {
      statuses.push({
        binding,
        detail: 'acceptance references an unsafe generation id',
        status: 'invalid-manifest',
      });
      continue;
    }
    let manifestText: string;
    try {
      manifestText = await readBoundedLabJson(
        join(
          input.outputRoot,
          'generations',
          record.generationId,
          'manifest.json'
        ),
        256 * 1024
      );
    } catch {
      statuses.push({
        binding,
        generationId: record.generationId,
        status: 'missing-manifest',
      });
      continue;
    }
    let parsedManifest: PilotManifest;
    try {
      const parsed = parsePilotManifest(JSON.parse(manifestText));
      if (!parsed.ok) {
        statuses.push({
          binding,
          detail: parsed.issues.join('; '),
          generationId: record.generationId,
          status: 'invalid-manifest',
        });
        continue;
      }
      parsedManifest = parsed.manifest;
    } catch {
      statuses.push({
        binding,
        generationId: record.generationId,
        status: 'invalid-manifest',
      });
      continue;
    }
    if (
      parsedManifest.merchantId !== binding.merchantId ||
      parsedManifest.assetId !== binding.assetId ||
      parsedManifest.role !== binding.role ||
      parsedManifest.source.sha256 !== binding.sourceSha256 ||
      verifyGenerationBinding({
        binding,
        generationId: record.generationId,
        manifest: parsedManifest,
      }) !== null
    ) {
      statuses.push({
        binding,
        generationId: record.generationId,
        status: 'binding-mismatch',
      });
      continue;
    }
    if (parsedManifest.recipeId !== PILOT_RECIPE_ID) {
      statuses.push({
        binding,
        detail: `recipe ${parsedManifest.recipeId} is not current`,
        generationId: record.generationId,
        status: 'stale-recipe',
      });
      continue;
    }
    const matched = matchPilotAcceptance({
      acceptance: record,
      manifest: parsedManifest,
    });
    if (!matched.ok) {
      statuses.push({
        binding,
        detail: matched.reason,
        generationId: record.generationId,
        status:
          record.verdict === 'rejected' ? 'rejected' : 'acceptance-mismatch',
      });
      continue;
    }
    const hashError = await verifyOutputHashes(
      input.outputRoot,
      record.generationId,
      parsedManifest
    );
    if (hashError) {
      statuses.push({
        binding,
        detail: hashError,
        generationId: record.generationId,
        status: 'hash-mismatch',
      });
      continue;
    }
    const tiers: ApprovedPilotTier[] = parsedManifest.tiers.map((tier) => ({
      actualWidth: tier.actualWidth,
      bytes: tier.bytes,
      contentType: tier.contentType,
      delivery: tier.delivery ?? 'legacy',
      fileName: tier.path,
      format: tier.format,
      generationId: record.generationId,
      height: tier.height,
      quality: tier.quality,
      requestedWidth: tier.requestedWidth,
      sha256: tier.sha256,
      width: tier.width,
    }));
    entries[indexKey(binding)] = Object.freeze(
      [...tiers].sort((left, right) => left.width - right.width)
    );
    statuses.push({
      binding,
      generationId: record.generationId,
      source: {
        bytes: parsedManifest.source.bytes,
        format: parsedManifest.source.format,
        orientedHeight: parsedManifest.source.orientedHeight,
        orientedWidth: parsedManifest.source.orientedWidth,
      },
      status: 'accepted',
    });
  }
  return { diagnostics, index: deepFreezeIndex({ entries }), statuses };
}
