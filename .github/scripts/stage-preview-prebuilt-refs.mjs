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
let insideOutputCount = 0;

for (const configPath of vcConfigs(outputDir)) {
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.error(`error: cannot parse ${configPath}: ${error.message}`);
    process.exit(1);
  }
  const maps = config?.filePathMap;
  if (!maps || typeof maps !== 'object') continue;
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
      usable += 1;
      continue;
    }
    const abs = resolve(root, value);
    const rel = relative(root, abs);
    if (rel === '' || rel === '.' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
      skipped.push({ value, reason: 'escapes-root' });
      kept[key] = value;
      usable += 1;
      continue;
    }
    const posixRel = rel.split(sep).join('/');
    if (posixRel === '.vercel/output' || posixRel.startsWith('.vercel/output/')) {
      skipped.push({ value, reason: 'inside-output' });
      kept[key] = value;
      usable += 1;
      insideOutputCount += 1;
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
      // systematically wrong base, where nothing real stages.
      skipped.push({ value, reason: 'missing' });
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
    config.filePathMap = kept;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
}

// Dropped refs should be redundant with the self-contained .func dirs:
// platform git-push deploys never consume filePathMap, and production
// works. Residual risk: if the phantom classification is wrong (wrong
// root, pruned deps, case drift), the deploy succeeds here and can fail
// at runtime (cf. vercel/vercel#15654 for the shape of that failure,
// though its cause was tracer incompleteness, not map truncation). The
// guardrails below catch systematic misclassification; preview READY plus
// served verification catch the rest. Counts are occurrences on both
// sides (a repeated phantom is repeated evidence); the resolving side
// counts staged plus output-internal values, which genuinely upload.
const resolving = staged.length + insideOutputCount;
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
if (missingCount > 0) {
  const missingVals = skipped.filter((s) => s.reason === 'missing').map((s) => s.value);
  const shown = missingVals.slice(0, 20);
  console.error(
    `WARNING: dropped ${missingCount} phantom reference(s) from shipped maps:\n` +
      shown.map((v) => `  ${v}`).join('\n') +
      (missingCount > shown.length ? `\n  ...and ${missingCount - shown.length} more` : '')
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
    .filter((s) => s.reason === 'missing')
    .map((s) => s.value.replace(/[`\r\n]/g, '').slice(0, 200));
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Prebuilt refs\nstaged ${new Set(staged).size}, skipped ${skipped.length} (${dropped.length} phantom)\n` +
      dropped.slice(0, 20).map((v) => `- \`${v}\``).join('\n') +
      (dropped.length > 0 ? '\n' : '')
  );
}
