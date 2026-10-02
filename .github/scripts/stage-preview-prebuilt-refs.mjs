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
// Layout rule mirrors the CLI: absolute values and values escaping the root
// are skipped (the CLI rejects them too). References already inside
// `.vercel/output` ship via the output artifact and are skipped here.
// Only staged values stay in the shipped filePathMaps: missing (phantom)
// and protected values are dropped so the CLI never re-adds them (it would
// ENOENT on the former and upload the latter). Fails closed only when
// EVERYTHING is phantom, which smells like a systematically wrong base.
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
    if (typeof value !== 'string' || value === '') continue;
    stringValues += 1;
    if (isAbsolute(value)) {
      skipped.push({ value, reason: 'absolute' });
      continue;
    }
    const abs = resolve(root, value);
    const rel = relative(root, abs);
    if (rel === '' || rel === '.' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
      skipped.push({ value, reason: 'escapes-root' });
      continue;
    }
    const posixRel = rel.split(sep).join('/');
    if (posixRel === '.vercel/output' || posixRel.startsWith('.vercel/output/')) {
      skipped.push({ value, reason: 'inside-output' });
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
      // systematically wrong base, where EVERYTHING is phantom.
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

if (stringValues > 0 && stagedValues.size === 0 && missingValues === stringValues) {
  console.error(
    'error: every filePathMap reference is missing; refusing to ship empty maps (wrong base?)'
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
