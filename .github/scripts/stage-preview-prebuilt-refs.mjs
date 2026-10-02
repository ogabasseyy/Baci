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
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
const stagedValues = new Set();
let stringValues = 0;
let missingValues = 0;

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
      skipped.push({ value, reason: 'inside-output' });
      kept[key] = value;
      continue;
    }
    if (
      posixRel === 'trusted-ops' ||
      posixRel.startsWith('trusted-ops/') ||
      posixRel === '.vercel' ||
      posixRel.startsWith('.vercel/')
    ) {
      skipped.push({ value, reason: 'protected-path' });
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
      missingValues += 1;
      continue;
    }
    const dest = join(stage, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(abs, dest);
    staged.push(posixRel);
    stagedValues.add(value);
    kept[key] = value;
  }
  if (Object.keys(kept).length !== Object.keys(maps).length) {
    config.filePathMap = kept;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
}

// Canary, not a correctness gate: dropped refs are redundant with the
// self-contained .func dirs (platform deploys prove it), so truncation
// cannot break the deployment. But phantoms scale ~1 per traced package
// while staged files scale many per package, so phantoms dominating the
// staged set smells like a systematically wrong base. Refuse to ship it.
if (stringValues > 0 && missingValues > staged.length) {
  console.error(
    `error: ${missingValues} missing reference(s) dominate ${staged.length} staged; refusing to ship (wrong base?)`
  );
  process.exit(1);
}

staged.sort();
writeFileSync(
  join(stage, '.preview-refs-manifest.json'),
  `${JSON.stringify({ refs: [...new Set(staged)], skipped }, null, 2)}\n`
);
console.log(
  `staged ${new Set(staged).size} referenced file(s), skipped ${skipped.length}`
);
