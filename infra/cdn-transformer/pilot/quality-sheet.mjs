import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCliArgs } from './cli-args.mjs';
import {
  buildEncoderIdentity,
  currentRecipeId,
  generationIdFor,
} from './generation-identity.mjs';
import { readInputSnapshot, verifySnapshotHash } from './input-store.mjs';
import { parsePilotManifest, PilotManifestError } from './manifest.mjs';
import { loadGeneration } from './manifest-store.mjs';

export class PilotSheetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PilotSheetError';
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

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
    if (error instanceof PilotManifestError && error.code === 'generation-missing') {
      throw new PilotSheetError(
        `no verified generation for asset "${record.assetId}" under current recipe "${recipeId}"`
      );
    }
    throw new PilotSheetError(error instanceof Error ? error.message : String(error));
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

function tierCells(tier, files, cssWidth) {
  const file = files.get(tier.path);
  const dataUri = `data:${tier.contentType};base64,${file.toString('base64')}`;
  return `<figure><img src="${dataUri}" width="${tier.width}" height="${tier.height}" alt="${escapeHtml(tier.format)} ${tier.width}w" style="max-width:${cssWidth * 2}px"/><figcaption>${escapeHtml(tier.format)} ${tier.width}w · q${tier.quality} · ${tier.bytes} B<br><code>${escapeHtml(tier.sha256.slice(0, 16))}…</code></figcaption></figure>`;
}

export async function buildQualitySheet({ inputRoot, inventoryPath, outputRoot, slots }) {
  const records = JSON.parse(await readFile(inventoryPath, 'utf8'));
  if (!Array.isArray(records) || records.length === 0) {
    throw new PilotSheetError('inventory is empty');
  }
  const sections = [];
  for (const record of records) {
    const geometry = slots?.[record.slot];
    if (!geometry || !Number.isInteger(geometry.cssWidth) || geometry.cssWidth < 1) {
      throw new PilotSheetError(`missing slot geometry for slot "${record.slot}"`);
    }
    const snapshot = await readInputSnapshot(inputRoot, record.sourcePath);
    if (!verifySnapshotHash(snapshot, record.sha256)) {
      throw new PilotSheetError(`snapshot changed for asset "${record.assetId}"`);
    }
    const {
      files,
      generationId,
      manifest,
    } = await findGenerationFor(outputRoot, record);
    const parsed = parsePilotManifest(manifest);
    if (!parsed.ok) {
      throw new PilotSheetError('stored manifest is invalid');
    }
    const originalUri = `data:${record.contentType ?? 'image/png'};base64,${snapshot.bytes.toString('base64')}`;
    const seenTiers = new Map();
    for (const tier of manifest.tiers) {
      if (!seenTiers.has(tier.requestedWidth)) {
        seenTiers.set(tier.requestedWidth, []);
      }
      seenTiers.get(tier.requestedWidth).push(tier);
    }
    // The visual comparison must be size-matched: each derivative renders
    // at its encoded width capped to twice the slot CSS width (the DPR
    // matrix ceiling), so the original renders at exactly that width —
    // never at a raw requested width the derivatives cannot reach
    // (capped rungs and narrow sources encode below their request).
    const rows = [...seenTiers.entries()]
      .map(([requestedWidth, tiers]) => {
        const compareWidth = Math.min(
          geometry.cssWidth * 2,
          ...tiers.map((tier) => tier.width)
        );
        return `<tr><td>${requestedWidth}px tier</td>
<td><figure><img src="${originalUri}" style="width:${compareWidth}px" alt="original scaled to ${compareWidth}px"/><figcaption>original · ${snapshot.bytes.length} B · ${record.width}x${record.height}</figcaption></figure></td>
${tiers.map((tier) => `<td>${tierCells(tier, files, geometry.cssWidth)}</td>`).join('\n')}</tr>`;
      })
      .join('\n');
    sections.push(`<section><h2>${escapeHtml(record.assetId)} · ${escapeHtml(record.role)} · slot ${escapeHtml(record.slot)}</h2>
<p>merchant <code>${escapeHtml(record.merchantId)}</code> · source <code>${escapeHtml(record.sha256.slice(0, 16))}…</code> · generation <code>${escapeHtml(generationId.slice(0, 16))}…</code> · recipe <code>${escapeHtml(manifest.recipeId)}</code> · slot CSS width ${geometry.cssWidth}px</p>
<table><thead><tr><th>tier</th><th>original (browser-scaled)</th><th>AVIF (actual pixels)</th><th>WebP (actual pixels)</th></tr></thead><tbody>${rows}</tbody></table></section>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pilot quality sheet</title>
<style>body{font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px;vertical-align:top}img{background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/16px 16px}code{font-size:12px}</style></head><body>
<h1>Merchant image pilot — quality sheet</h1>
<p><strong>Inspection aid only.</strong> This sheet renders verified generation bytes for human review; it is not visual acceptance and does not bypass the acceptance requirement.</p>
${sections.join('\n')}</body></html>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = parseCliArgs(process.argv.slice(2), ['input-root', 'inventory', 'output-root', 'slots', 'out']);
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
