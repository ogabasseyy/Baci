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
// values stay in the shipped maps (the CLI rejects or resolves them as
// in an unmodified map) but never count as usable or resolving. Missing
// (phantom), symlink, protected, and invalid values drop: symlinks are
// never followed, so outside-root targets cannot be laundered into the
// stage artifact. Ties refuse to ship: missing must be strictly
// outnumbered by resolving. Guardrails are fail-fast UX, not the
// security boundary: the build job is untrusted, so the deploy-side
// materializer re-enforces them.
//
// Usage: stage-preview-prebuilt-refs.mjs [project-root] [staging-dir]
// Defaults: root = cwd, staging = <root>/.preview-refs-stage (recreated).
const sanitizeRef = (v) => v.replace(/[\0-\x1f`]/g, '').slice(0, 200);
import { appendFileSync, copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  // Null-prototype dict: build-controlled keys may include __proto__,
  // which a plain object would silently swallow instead of keeping.
  const kept = Object.create(null);
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
      // Stale or linked asset refs point at nothing the output upload
      // carries, so only a real file counts as resolving. lstat, not
      // stat: never resolve through a symlink here.
      let outStat;
      try {
        outStat = lstatSync(abs);
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
      srcStat = lstatSync(abs);
    } catch {
      srcStat = null;
    }
    if (!srcStat?.isFile() || srcStat?.isSymbolicLink()) {
      // Phantom refs (e.g. transient build files) drop from the shipped
      // map instead of failing the build; the guardrail below catches a
      // systematically wrong base. lstat, not stat: a symlink (even to a
      // real file) must never be followed here, or an outside-root or
      // protected target would be laundered into the stage artifact as a
      // regular file. Distinct reasons, all unresolved on both guardrails.
      const reason = !srcStat ? 'missing' : srcStat.isSymbolicLink() ? 'symlink' : 'non-file';
      skipped.push({ value, reason });
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
// global backstop below is for a systematically wrong base. Tie policy:
// missing must be strictly outnumbered by resolving; a tie refuses to
// ship, since a wrong drop surfaces as a runtime request failure.
// Protected/invalid drops are exempt from this ratio by design: those
// values can never be legitimate runtime refs (CI-tree paths, corrupt
// data), so their count carries no wrong-base signal. Per-config
// total-loss still fails when a function loses everything usable.
const resolving = new Set(staged).size + new Set(insideOutputValues).size;
if (missingCount > 0 && missingCount >= resolving) {
  console.error(
    `error: ${missingCount} missing reference(s) vs ${resolving} resolving; refusing to ship (wrong base?)`
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
    .filter((s) => s.reason === 'missing' || s.reason === 'non-file' || s.reason === 'symlink')
    .map((s) => sanitizeRef(s.value));
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
    .filter((s) => s.reason === 'missing' || s.reason === 'non-file' || s.reason === 'symlink')
    .map((s) => sanitizeRef(s.value));
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
// Last step: apply the buffered map rewrites. Serialize every body
// before touching disk, then write each config via temp-file plus
// rename, so a mid-loop throw cannot leave a half-written map.
const serialized = pendingRewrites.map(({ configPath, config, kept }) => {
  config.filePathMap = kept;
  return { configPath, body: `${JSON.stringify(config, null, 2)}\n` };
});
for (const { configPath, body } of serialized) {
  const tmp = `${configPath}.tmp-${process.pid}`;
  writeFileSync(tmp, body);
  renameSync(tmp, configPath);
}
