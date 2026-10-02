#!/usr/bin/env node
// Materialize staged prebuilt refs from quarantine into the deploy root.
//
// The refs artifact is produced by the UNTRUSTED build job (target-ref
// install/build scripts run before staging and share its filesystem, so the
// staging rules there are fail-fast UX, not a boundary). This script runs in
// the trusted deploy job and is the actual boundary: it copies the
// quarantined files into place while refusing anything that could escalate
// the artifact from inert data to code or config execution:
//
//   - non-regular files (symlinks especially: never followed or recreated),
//   - paths under trusted-ops/ (executed helpers) or .vercel/ (project link
//     and pulled env), or the quarantine dir itself,
//   - anything that would land outside the root.
//
// Everything else (the NFT-traced node_modules/.next/source subset) is data
// the CLI uploads; it is never executed here. Any refusal fails closed.
//
// Usage: materialize-preview-prebuilt-refs.mjs [deploy-root] [quarantine-dir]
// Defaults: root = cwd, quarantine = <root>/.preview-refs-quarantine.
import { copyFileSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());
const quarantine = resolve(
  process.argv[3] ?? join(root, '.preview-refs-quarantine')
);

const DENIED_PREFIXES = ['trusted-ops', '.vercel', '.preview-refs-quarantine'];

function denied(rel) {
  return DENIED_PREFIXES.some((p) => rel === p || rel.startsWith(`${p}/`));
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // Never follow symlinks: classify by lstat, copy only regular files.
    const st = lstatSync(full);
    if (st.isDirectory() && !entry.isSymbolicLink()) walk(full, found);
    else found.push(full);
  }
  return found;
}

let quarantineStat;
try {
  quarantineStat = lstatSync(quarantine);
} catch {
  quarantineStat = null;
}
// lstat (no follow): a symlinked quarantine fails this check too.
if (!quarantineStat?.isDirectory()) {
  console.error(`error: quarantine dir missing: ${quarantine}`);
  process.exit(1);
}

let count = 0;
for (const full of walk(quarantine)) {
  const rel = relative(quarantine, full);
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..') {
    console.error(`error: quarantined path escapes: ${rel}`);
    process.exit(1);
  }
  const posixRel = rel.split(sep).join('/');
  if (denied(posixRel)) {
    console.error(`error: quarantined path denied: ${posixRel}`);
    process.exit(1);
  }
  if (!lstatSync(full).isFile()) {
    console.error(`error: quarantined path is not a regular file: ${posixRel}`);
    process.exit(1);
  }
  const dest = join(root, rel);
  if (relative(root, dest).startsWith(`..${sep}`)) {
    console.error(`error: destination escapes root: ${posixRel}`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(full, dest);
  count += 1;
}

console.log(`materialized ${count} referenced file(s) from quarantine`);
