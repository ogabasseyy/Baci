#!/usr/bin/env node
// Stage the NFT-traced source files a split prebuilt deploy needs.
//
// `vercel deploy --prebuilt` walks the deployment root, reads every
// `.vc-config.json` `filePathMap` under `.vercel/output`, and re-adds the
// referenced source files (e.g. the traced `node_modules` subset) to the
// upload set. A split workflow whose deploy job holds only `.vercel/output`
// therefore dies with ENOENT on the dangling references. This script runs in
// the build job (which has the source tree and installed deps) and copies
// every referenced file into a staging dir preserving root-relative layout,
// so the deploy job can extract it at root and the CLI's references resolve.
//
// Layout rule mirrors the CLI: absolute, escaping, and output-internal
// values are skipped from staging but stay in the shipped maps, where the
// CLI rejects or resolves them exactly as in an unmodified map. Only
// missing (phantom), protected, and invalid values are dropped: the CLI
// would ENOENT, wrongly upload, or crash on them. Fails closed when
// nothing stages while references are missing (wrong-base smell).
// Absolute and escaping values stay in the map but never count as usable
// or resolving: the CLI rejects them, so a function kept alive only by
// such entries would ship with zero genuinely resolving references.
// These staging rules are fail-fast UX, not the security boundary: the
// build job is untrusted, so the deploy-side materializer re-enforces them.
//
// Usage: stage-preview-prebuilt-refs.mjs [project-root] [staging-dir]
// Defaults: root = cwd, staging = <root>/.preview-refs-stage (recreated).
import { appendFileSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());
const stage = resolve(process.argv[3] ?? join(root, '.preview-refs-stage'));
const outputDir = join(root, '.vercel', 'output');

function vcConfigs(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) vcConfigs(full, found);
    else if (entry.isFile() && entry.name === '.vc-config.json') found.push(full);
  }
  return found;
}

let outputStat;
try {
  outputStat = statSync(outputDir);
} catch {
  outputStat = null;
}
if (!outputStat?.isDirectory()) {
  console.error(`error: prebuilt output dir missing: ${outputDir}`);
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const staged = [];
const skipped = [];
const unusableConfigs = [];
let stringValues = 0;
let missingCount = 0;
const insideOutputValues = [];
const pendingRewrites = [];

for (const configPath of vcConfigs(outputDir)) {
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.error(`error: cannot parse ${configPath}: ${error.message}`);
    process.exit(1);
  }
  const maps = config?.filePathMap;
  // A missing map is normal (static configs); a present-but-malformed
  // one is corrupt either way, so fail closed for any non-object.
  if (maps === undefined || maps === null) continue;
  if (typeof maps !== 'object' || Array.isArray(maps)) {
    console.error(`error: filePathMap is not an object in ${configPath}`);
    process.exit(1);
  }
  const kept = {};
  let usable = 0;
  let dropped = 0;
  for (const [key, value] of Object.entries(maps)) {
    // Only missing, protected, and invalid values leave the shipped map:
    // the CLI would ENOENT, wrongly upload, or crash on them. Absolute,
    // escaping, and output-internal values stay: the CLI rejects or
    // resolves them exactly as in an unmodified map.
    if (typeof value !== 'string' || value === '') {
      skipped.push({
        value: `${key}=${JSON.stringify(value)?.slice(0, 200) ?? typeof value}`,
        reason: 'invalid',
      });
      dropped += 1;
      continue;
    }
    stringValues += 1;
    if (isAbsolute(value)) {
      skipped.push({ value, reason: 'absolute' });
      kept[key] = value;
      continue;
    }
    const abs = resolve(root, value);
    const rel = relative(root, abs);
    if (rel === '' || rel === '.' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
      skipped.push({ value, reason: 'escapes-root' });
      kept[key] = value;
      continue;
    }
    const posixRel = rel.split(sep).join('/');
    if (posixRel === '.vercel/output' || posixRel.startsWith('.vercel/output/')) {
      // Lexically inside the output dir is not enough: a stale asset
      // reference points at nothing the output upload carries, so verify
      // it is a real file before treating it as resolving.
      let outStat;
      try {
        outStat = statSync(abs);
      } catch {
        outStat = null;
      }
      if (!outStat?.isFile()) {
        skipped.push({ value, reason: 'missing' });
        missingCount += 1;
        dropped += 1;
        continue;
      }
      skipped.push({ value, reason: 'inside-output' });
      kept[key] = value;
      usable += 1;
      // Dedupe by normalized path: alias spellings of one file must
      // not each count as resolving.
      insideOutputValues.push(posixRel);
      continue;
    }
    if (
      posixRel === 'trusted-ops' ||
      posixRel.startsWith('trusted-ops/') ||
      posixRel === '.vercel' ||
      posixRel.startsWith('.vercel/')
    ) {
      skipped.push({ value, reason: 'protected-path' });
      dropped += 1;
      continue;
    }
    let srcStat;
    try {
      srcStat = statSync(abs);
    } catch {
      srcStat = null;
    }
    if (!srcStat?.isFile()) {
      // Phantom reference (e.g. transient build files): the CLI would
      // ENOENT re-adding it, so drop it from the shipped map instead of
      // failing the whole build. The guardrail below catches a
      // systematically wrong base, where nothing real stages. An existing
      // non-file (directory, FIFO) is a different condition from an
      // absent phantom, so it gets its own manifest reason while still
      // counting as unresolved on both guardrails.
      skipped.push({ value, reason: srcStat ? 'non-file' : 'missing' });
      missingCount += 1;
      dropped += 1;
      continue;
    }
    const dest = join(stage, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(abs, dest);
    staged.push(posixRel);
    kept[key] = value;
    usable += 1;
  }
  if (dropped > 0 && usable === 0) unusableConfigs.push(configPath);
  if (Object.keys(kept).length !== Object.keys(maps).length) {
    // Buffer the rewrite: the guardrails run after the full scan, and a
    // failed run must not leave truncated maps on disk — a same-workspace
    // retry would see fewer string values and could wrongly pass.
    pendingRewrites.push({ configPath, config, kept });
  }
}

// Dropped refs should be redundant with the self-contained .func dirs:
// platform git-push deploys never consume filePathMap, and production
// works. Residual risk: if the phantom classification is wrong (wrong
// root, pruned deps, case drift), the deploy succeeds here and can fail
// at runtime (cf. vercel/vercel#15654 for the shape of that failure,
// though its cause was tracer incompleteness, not map truncation). The
// guardrails below catch systematic misclassification; preview READY plus
// served verification catch the rest. The missing side counts
// occurrences (a repeated phantom is repeated evidence); the resolving
// side counts distinct files, so one heavily-referenced file cannot mask
// many distinct drops. Observed incident motivating this shape: 21
// transient `apps/web/.next/node_modules/*` refs alongside a normally
// staged tree. The per-config total-loss check is the primary guard; the
// global majority rule below is the backstop for a systematically wrong
// base.
const resolving = new Set(staged).size + new Set(insideOutputValues).size;
if (stringValues > 0 && missingCount > resolving) {
  console.error(
    `error: ${missingCount} missing reference(s) dominate ${resolving} resolving; refusing to ship (wrong base?)`
  );
  process.exit(1);
}
if (unusableConfigs.length > 0) {
  console.error(
    `error: ${unusableConfigs.length} function(s) lost every usable reference:\n` +
      unusableConfigs.map((p) => `  ${p}`).join('\n')
  );
  process.exit(1);
}
// Guardrails passed. Warnings, manifest, and summary all land before
// any map is touched (rewrites apply last), so any failure above
// leaves the original maps on disk for a same-workspace retry.
const droppedProtected = skipped.filter((s) => s.reason === 'protected-path').length;
const droppedInvalid = skipped.filter((s) => s.reason === 'invalid').length;
if (droppedProtected > 0 || droppedInvalid > 0) {
  const parts = [];
  if (droppedProtected > 0) parts.push(`${droppedProtected} protected-path`);
  if (droppedInvalid > 0) parts.push(`${droppedInvalid} invalid`);
  const total = droppedProtected + droppedInvalid;
  console.error(
    `WARNING: dropped ${parts.join(' and ')} ${total === 1 ? 'entry' : 'entries'} from shipped maps (see .preview-refs-manifest.json)`
  );
  console.error(
    `::warning::Dropped ${parts.join(' and ')} filePathMap ${total === 1 ? 'entry' : 'entries'} from shipped preview maps; serve-verify this preview.`
  );
}
if (missingCount > 0) {
  const missingVals = skipped
    .filter((s) => s.reason === 'missing' || s.reason === 'non-file')
    .map((s) => s.value);
  const shown = missingVals.slice(0, 20);
  console.error(
    `WARNING: dropped ${missingCount} dangling reference(s) from shipped maps:\n` +
      shown.map((v) => `  ${v}`).join('\n') +
      (missingCount > shown.length ? `\n  ...and ${missingCount - shown.length} more` : '') +
      '\nDropped refs can fail at request time: serve-verify this preview (fonts, hero payload), do not trust READY alone.'
  );
  console.error(
    `::warning::Dropped ${missingCount} dangling filePathMap reference(s) from shipped preview maps; serve-verify this preview, do not trust READY alone.`
  );
}

staged.sort();
writeFileSync(
  join(stage, '.preview-refs-manifest.json'),
  `${JSON.stringify({ refs: [...new Set(staged)], skipped }, null, 2)}\n`
);
console.log(
  `staged ${new Set(staged).size} referenced file(s), skipped ${skipped.length}`
);
// Surface truncation on the build summary (same convention as the deploy
// helper): dropped refs are listed in the job output and the manifest,
// and this line makes the counts visible without opening either.
if (process.env.GITHUB_STEP_SUMMARY) {
  // Values are build-controlled: strip span-breaking characters (same
  // rule as the deploy helper's ref sanitization).
  const dropped = skipped
    .filter((s) => s.reason === 'missing' || s.reason === 'non-file')
    .map((s) => s.value.replace(/[`\r\n]/g, '').slice(0, 200));
  const guardedCounts = [];
  if (droppedProtected > 0) guardedCounts.push(`${droppedProtected} protected`);
  if (droppedInvalid > 0) guardedCounts.push(`${droppedInvalid} invalid`);
  const danglingLabel =
    `(${dropped.length} dangling` +
    (guardedCounts.length > 0 ? `, ${guardedCounts.join(', ')}` : '') +
    ')';
  // Best-effort annotation: the manifest is written and no map is
  // touched yet, so a broken summary path must not fail the build.
  try {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Prebuilt refs\nstaged ${new Set(staged).size}, skipped ${skipped.length} ${danglingLabel}\n` +
        dropped.slice(0, 20).map((v) => `- \`${v}\``).join('\n') +
        (dropped.length > 0 ? '\n' : '') +
        (dropped.length > 0
          ? 'Dropped refs can fail at request time: serve-verify this preview, do not trust READY alone.\n'
          : '')
    );
  } catch (error) {
    console.error(`WARNING: could not write step summary: ${error.message}`);
  }
}
// Last step: apply the buffered map rewrites. Everything fallible
// above (guards, manifest, summary) completed first, so a failure
// anywhere earlier leaves the original maps for a retry to see.
for (const { configPath, config, kept } of pendingRewrites) {
  config.filePathMap = kept;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}
