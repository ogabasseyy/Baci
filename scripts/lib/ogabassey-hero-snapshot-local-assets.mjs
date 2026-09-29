// Local asset verification for the hero snapshot pipeline: the freshness
// check compares remote source hashes, but the manifest also references
// checked-in AVIF files under `public/_hero/<slug>/`. A deleted,
// truncated, or hand-replaced file keeps the entry's URL key valid while
// serving a missing or corrupt hero once the flag is on — so every
// referenced `href`/`srcSet` file must exist, be a regular file, and carry
// bytes matching its content-addressed filename (sha256 prefix + width).

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { MANAGED_FILE_PATTERN } from './ogabassey-hero-snapshot-config.mjs';
import { HeroSnapshotError } from './ogabassey-hero-snapshot-errors.mjs';

function referencedFiles(entry) {
  const refs = [{ descriptor: null, fromSrcSet: false, path: entry.href }];
  for (const part of String(entry.srcSet ?? '').split(',')) {
    const [path, descriptor] = part.trim().split(/\s+/);
    if (path) {
      refs.push({ descriptor: descriptor ?? null, fromSrcSet: true, path });
    }
  }
  return refs;
}

function checkOneFile({ descriptor, fromSrcSet, outDir, path }) {
  // Generator-authored paths are plain ASCII with no escapes: reject
  // percent-encoding before interpreting, so `/%2e%2e/` (and double-encoded
  // `/%252e%2e/`) can never validate a basename here while browsers
  // normalize the rendered URL somewhere else.
  if (typeof path !== 'string' || path.includes('%')) {
    return `${path}: not a same-origin snapshot path`;
  }
  // The reference must name exactly the directory being verified —
  // `/_hero/<slug>/<file>` with no subpaths — so traversal is structural,
  // and a slug-mismatched ref cannot pass against the wrong directory.
  const segments = path.split('/');
  const expectedDir = basename(outDir);
  if (
    segments.length !== 4 ||
    segments[0] !== '' ||
    segments[1] !== '_hero' ||
    segments[2] !== expectedDir
  ) {
    return `${path}: not a snapshot path in /_hero/${expectedDir}/`;
  }
  const fileName = segments[3];
  const match = MANAGED_FILE_PATTERN.exec(fileName ?? '');
  if (!match?.groups) {
    return `${path}: not a pipeline-managed asset name`;
  }
  if (fromSrcSet && descriptor === null) {
    return `${path}: srcSet candidate is missing its width descriptor`;
  }
  if (descriptor !== null && descriptor !== `${match.groups.width}w`) {
    return `${path}: srcSet descriptor ${descriptor} does not match file width ${match.groups.width}w`;
  }
  let stat;
  try {
    stat = lstatSync(resolve(outDir, fileName));
  } catch {
    return `${path}: file missing under ${outDir}`;
  }
  if (!stat.isFile()) {
    return `${path}: not a regular file`;
  }
  const actual = createHash('sha256')
    .update(readFileSync(resolve(outDir, fileName)))
    .digest('hex');
  if (!actual.startsWith(match.groups.hash)) {
    return `${path}: bytes do not match the content hash in the filename`;
  }
  return null;
}

export function verifySnapshotLocalAssets({ entries, outDir, urls }) {
  const problems = [];
  const verified = new Set();
  for (const url of urls) {
    const refs = referencedFiles(entries[url]);
    if (!refs.some((ref) => ref.fromSrcSet)) {
      problems.push(`${url}: srcSet has no candidates`);
    }
    for (const ref of refs) {
      const problem = checkOneFile({ ...ref, outDir });
      if (problem) {
        problems.push(`${url}: ${problem}`);
      } else {
        verified.add(ref.path.split('/').pop());
      }
    }
  }
  if (problems.length > 0) {
    throw new HeroSnapshotError(
      `snapshot local assets invalid for ${problems.length} reference(s), re-bake: ${problems.join('; ')}`
    );
  }
  return { verifiedFiles: [...verified].sort() };
}
