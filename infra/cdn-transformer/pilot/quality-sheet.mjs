import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from './cli-args.mjs';
import {
  buildEncoderIdentity,
  currentRecipeId,
  generationIdFor,
} from './generation-identity.mjs';
import { readInputSnapshot, verifySnapshotHash } from './input-store.mjs';
import {
  validateInventory,
  validateInventoryUniqueness,
} from './job-schema.mjs';
import { PilotManifestError, parsePilotManifest } from './manifest.mjs';
import { loadGeneration } from './manifest-store.mjs';
import {
  escapeHtml,
  originalContentType,
  PilotSheetError,
  parseMountCrop,
  tierCells,
} from './quality-sheet-render.mjs';

export { PilotSheetError };

async function findGenerationFor(outputRoot, record) {
  // Bind the sheet to the generation the current recipe+encoder would
  // produce: stale generations from earlier recipes may coexist in the
  // output root and must never render as current bytes.
  const recipeId = currentRecipeId();
  const expectedId = generationIdFor({
    encoderIdentity: buildEncoderIdentity(),
    job: {
      assetId: record.assetId,
      merchantId: record.merchantId,
      role: record.role,
    },
    recipeId,
    sourceSha256: record.sha256,
  });
  let manifest;
  let files;
  try {
    ({ files, manifest } = await loadGeneration(outputRoot, expectedId));
  } catch (error) {
    if (
      error instanceof PilotManifestError &&
      error.code === 'generation-missing'
    ) {
      throw new PilotSheetError(
        `no verified generation for asset "${record.assetId}" under current recipe "${recipeId}"`
      );
    }
    throw new PilotSheetError(
      error instanceof Error ? error.message : String(error)
    );
  }
  const rebound = generationIdFor({
    encoderIdentity: manifest.encoder,
    job: {
      assetId: manifest.assetId,
      merchantId: manifest.merchantId,
      role: manifest.role,
    },
    recipeId: manifest.recipeId,
    sourceSha256: manifest.source.sha256,
  });
  if (
    rebound !== expectedId ||
    manifest.merchantId !== record.merchantId ||
    manifest.assetId !== record.assetId ||
    manifest.role !== record.role ||
    manifest.source.sha256 !== record.sha256
  ) {
    throw new PilotSheetError(
      `generation "${expectedId}" does not match asset "${record.assetId}" under current recipe "${recipeId}"`
    );
  }
  return { files, generationId: expectedId, manifest };
}

export async function buildQualitySheet({
  inputRoot,
  inventoryPath,
  outputRoot,
  slots,
}) {
  const records = JSON.parse(await readFile(inventoryPath, 'utf8'));
  if (!Array.isArray(records) || records.length === 0) {
    throw new PilotSheetError('inventory is empty');
  }
  // Shape + cap before rendering: an unvalidated 10k-record inventory
  // would embed gigabytes of data URIs, and a malformed record must
  // fail here — not half-way through a sheet a reviewer might trust.
  const validated = validateInventory(
    records.map((entry) => ({
      assetId: entry?.assetId,
      expectedSha256: entry?.sha256,
      merchantId: entry?.merchantId,
      role: entry?.role,
      schemaVersion: entry?.schemaVersion,
      sourcePath: entry?.sourcePath,
    }))
  );
  if (!validated.ok) {
    throw new PilotSheetError(
      `invalid inventory: ${validated.errors.join('; ')}`
    );
  }
  const unique = validateInventoryUniqueness(records);
  if (!unique.ok) {
    throw new PilotSheetError(`invalid inventory: ${unique.errors.join('; ')}`);
  }
  const sections = [];
  let overSourceTiers = 0;
  for (const record of records) {
    const geometry = slots?.[record.slot];
    if (
      !geometry ||
      !Number.isInteger(geometry.cssWidth) ||
      geometry.cssWidth < 1
    ) {
      throw new PilotSheetError(
        `missing slot geometry for slot "${record.slot}"`
      );
    }
    const crop = parseMountCrop(geometry, record.slot);
    const snapshot = await readInputSnapshot(inputRoot, record.sourcePath);
    if (!verifySnapshotHash(snapshot, record.sha256)) {
      throw new PilotSheetError(
        `snapshot changed for asset "${record.assetId}"`
      );
    }
    const { files, generationId, manifest } = await findGenerationFor(
      outputRoot,
      record
    );
    const parsed = parsePilotManifest(manifest);
    if (!parsed.ok) {
      throw new PilotSheetError('stored manifest is invalid');
    }
    overSourceTiers += manifest.tiers.filter(
      (tier) => tier.delivery === 'generated-over-source'
    ).length;
    const originalUri = `data:${originalContentType(record)};base64,${snapshot.bytes.toString('base64')}`;
    const seenTiers = new Map();
    for (const tier of manifest.tiers) {
      if (!seenTiers.has(tier.requestedWidth)) {
        seenTiers.set(tier.requestedWidth, []);
      }
      seenTiers.get(tier.requestedWidth).push(tier);
    }
    // The visual comparison must be size-matched: each derivative renders
    // at its encoded width capped to three times the slot CSS width (the
    // DPR-3 review ceiling — phones negotiate DPR 3), so the original
    // renders at exactly that width — never at a raw requested width the
    // derivatives cannot reach (capped rungs and narrow sources encode
    // below their request). The caption states which ceiling bound the
    // comparison: full DPR-3 review, or the encoded-pixel width.
    const mountNote =
      crop === null
        ? ''
        : ` · mount ${escapeHtml(crop.aspectRatio)} ${escapeHtml(crop.fit)} ${escapeHtml(crop.position)}`;
    const rows = [...seenTiers.entries()]
      .map(([requestedWidth, tiers]) => {
        const dprCeiling = geometry.cssWidth * 3;
        const compareWidth = Math.min(
          dprCeiling,
          ...tiers.map((tier) => tier.width)
        );
        const ceilingNote =
          compareWidth < dprCeiling ? 'encoded-pixel ceiling' : '3× CSS';
        const originalStyle =
          crop === null
            ? `width:${compareWidth}px`
            : `width:${compareWidth}px;aspect-ratio:${crop.aspectRatio};object-fit:${crop.fit};object-position:${crop.position}`;
        return `<tr><td>${requestedWidth}px tier</td>
<td><figure><img src="${originalUri}" style="${originalStyle}" alt="original scaled to ${compareWidth}px"/><figcaption>original · ${snapshot.bytes.length} B · ${escapeHtml(record.width)}x${escapeHtml(record.height)} · compared at ${compareWidth}px (${ceilingNote})${mountNote}</figcaption></figure></td>
${tiers.map((tier) => `<td>${tierCells(tier, files, geometry.cssWidth, crop, compareWidth)}</td>`).join('\n')}</tr>`;
      })
      .join('\n');
    sections.push(`<section><h2>${escapeHtml(record.assetId)} · ${escapeHtml(record.role)} · slot ${escapeHtml(record.slot)}</h2>
<p>merchant <code>${escapeHtml(record.merchantId)}</code> · source <code>${escapeHtml(record.sha256.slice(0, 16))}…</code> · generation <code>${escapeHtml(generationId.slice(0, 16))}…</code> · recipe <code>${escapeHtml(manifest.recipeId)}</code> · slot CSS width ${geometry.cssWidth}px${mountNote}</p>
<table><thead><tr><th>tier</th><th>original (browser-scaled)</th><th>AVIF (actual pixels)</th><th>WebP (actual pixels)</th></tr></thead><tbody>${rows}</tbody></table></section>`);
  }
  const overSourceNote =
    overSourceTiers > 0
      ? `<p><strong>Over-source warning:</strong> ${overSourceTiers} tier(s) serve more bytes than their source (generated-over-source); the never-larger guard is per rung/format only, and no merchant-wide savings claim applies while these exist.</p>\n`
      : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pilot quality sheet</title>
<style>body{font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px;vertical-align:top}img{background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/16px 16px}code{font-size:12px}</style></head><body>
<h1>Merchant image pilot — quality sheet</h1>
<p><strong>Inspection aid only.</strong> This sheet renders verified generation bytes for human review; it is not visual acceptance and does not bypass the acceptance requirement.</p>
${overSourceNote}${sections.join('\n')}</body></html>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = parseCliArgs(process.argv.slice(2), [
      'input-root',
      'inventory',
      'output-root',
      'slots',
      'out',
    ]);
    const slots = JSON.parse(await readFile(args.slots, 'utf8'));
    const html = await buildQualitySheet({
      inputRoot: args['input-root'],
      inventoryPath: args.inventory,
      outputRoot: args['output-root'],
      slots,
    });
    await writeFile(args.out, html);
    console.log(JSON.stringify({ bytes: html.length, out: args.out }));
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
