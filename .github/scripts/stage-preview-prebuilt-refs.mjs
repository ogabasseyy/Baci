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
// (phantom), escaped-link, protected, and invalid values drop: every
// ref resolves through all links and re-validates on the real path,
// so outside-root targets cannot be laundered into staging. Ties
// refuse to ship: missing must be strictly outnumbered by resolving.
// Guardrails are fail-fast UX, not the
// security boundary: the build job is untrusted, so the deploy-side
// materializer re-enforces them.
//
// Usage: stage-preview-prebuilt-refs.mjs [project-root] [staging-dir]
// Defaults: root = cwd, staging = <root>/.preview-refs-stage (recreated).
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { writeReport } from './stage-preview-prebuilt-refs-report.mjs';

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

// realRoot is safe to resolve here: the output-dir check above already
// exited unless the root tree exists.
const realRoot = realpathSync(root);
const escapesRoot = (r) =>
  r === '' || r === '.' || r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r);
const protectedPosix = (p) =>
  p === 'trusted-ops' || p.startsWith('trusted-ops/') || p === '.vercel' || p.startsWith('.vercel/');
const toPosix = (r) => r.split(sep).join('/');
// Resolve through every ancestor: lstat alone only sees the final
// component, so a symlinked ancestor could otherwise launder
// outside-root or protected bytes into the stage artifact.
function resolveReal(abs) {
  try {
    const real = realpathSync(abs);
    return { real, rel: relative(realRoot, real) };
  } catch {
    return null;
  }
}
function isRegularFile(p) {
  try {
    return lstatSync(p).isFile();
  } catch {
    return false;
  }
}

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
    if (escapesRoot(rel)) {
      skipped.push({ value, reason: 'escapes-root' });
      kept[key] = value;
      continue;
    }
    const posixRel = toPosix(rel);
    if (posixRel === '.vercel/output' || posixRel.startsWith('.vercel/output/')) {
      // Only a real file genuinely under the output dir counts as
      // resolving: resolve through every ancestor, since a symlinked
      // ancestor could point at nothing the output upload carries.
      const out = resolveReal(abs);
      const outPosix = out ? toPosix(out.rel) : '..';
      if (!out || !outPosix.startsWith('.vercel/output/') || !isRegularFile(out.real)) {
        skipped.push({ value, reason: 'missing' });
        missingCount += 1;
        dropped += 1;
        continue;
      }
      skipped.push({ value, reason: 'inside-output' });
      kept[key] = value;
      usable += 1;
      // Dedupe by resolved path: alias spellings of one file must
      // not each count as resolving.
      insideOutputValues.push(outPosix);
      continue;
    }
    if (protectedPosix(posixRel)) {
      skipped.push({ value, reason: 'protected-path' });
      dropped += 1;
      continue;
    }
    // Resolve through final and ancestor links, then re-validate on
    // the real path: the lexical value may point anywhere, so root,
    // protected prefixes, and file type are all checked there.
    const target = resolveReal(abs);
    const targetPosix = target ? toPosix(target.rel) : '..';
    if (!target) {
      skipped.push({ value, reason: 'missing' });
      missingCount += 1;
      dropped += 1;
      continue;
    }
    if (escapesRoot(target.rel)) {
      // Unlike lexically-escaping values (which the CLI rejects
      // itself), a link-escaped value looks innocent, so the CLI would
      // ENOENT re-adding it in a deploy tree without the link: drop it.
      skipped.push({ value, reason: 'escaped-link' });
      missingCount += 1;
      dropped += 1;
      continue;
    }
    if (protectedPosix(targetPosix)) {
      skipped.push({ value, reason: 'protected-path' });
      dropped += 1;
      continue;
    }
    if (!isRegularFile(target.real)) {
      skipped.push({ value, reason: 'non-file' });
      missingCount += 1;
      dropped += 1;
      continue;
    }
    // Stage from the resolved path at the lexical layout: the shipped
    // map keeps the lexical value, so the CLI looks it up there.
    const dest = join(stage, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(target.real, dest);
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
// any map is touched (rewrites apply last), so any failure in the
// report leaves the original maps on disk for a retry to see.
writeReport({ stage, staged, skipped, missingCount });
// Last step: apply the buffered map rewrites. Two phases — serialize
// and write every temp file before the first rename — so a throw
// cannot leave a half-written map, only (in the tiny rename window) a
// mixed config set of individually consistent files. Temp names are
// deterministic per config, so a retry overwrites rather than piles up
// stale files, and leftovers from a killed run are swept first.
const tmpFor = (configPath) => `${configPath}.tmp-stage-refs`;
for (const { configPath } of pendingRewrites) rmSync(tmpFor(configPath), { force: true });
const serialized = pendingRewrites.map(({ configPath, config, kept }) => {
  config.filePathMap = kept;
  return { configPath, body: `${JSON.stringify(config, null, 2)}\n` };
});
try {
  for (const { configPath, body } of serialized) writeFileSync(tmpFor(configPath), body);
  for (const { configPath } of serialized) renameSync(tmpFor(configPath), configPath);
} catch (error) {
  for (const { configPath } of serialized) {
    try {
      rmSync(tmpFor(configPath), { force: true });
    } catch {
      // Best-effort: the sweep above removes leftovers on retry.
    }
  }
  throw error;
}
