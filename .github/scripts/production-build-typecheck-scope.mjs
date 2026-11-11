import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Toolchain and configuration that decide how the production build type checks:
 * scripts, tsconfig files, the typed-route preparation, the Next config and
 * version, and the workflow that runs the check.
 *
 * The typecheck job only starts when the `web` filter in .github/filters/ci.yml
 * matches, so every path here must also be matched there (pinned in the contract
 * test). Patches reach this list through pnpm-lock.yaml, and the deploy workflow's
 * compiler budget is pinned statically against this step instead of by a trigger.
 */
export const PRODUCTION_TYPECHECK_TRIGGERS = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^\.npmrc$/,
  /^turbo\.json$/,
  /^tsconfig[^/]*\.json$/,
  /^\.github\/workflows\/ci\.yml$/,
  /^\.github\/actions\/(?:pnpm-install-cached|setup-pnpm-store)\//,
  /^\.github\/scripts\/production-(?:build-)?typecheck-scope[^/]*$/,
];

const PRODUCTION_PROGRAM_ROOTS = /^(?:apps\/web|packages)\//;
// Mirrors the test roots tsconfig.build.json excludes, plus prose.
const OUTSIDE_PRODUCTION_PROGRAM =
  /\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:__tests__|__mocks__)\/|\.(?:md|mdx)$/;

/**
 * The production program can report errors the normal typecheck does not (it is a
 * differently shaped program checked with a different declaration copy), so any
 * change to code that is part of it runs the check. Only pull requests that touch
 * nothing in the production program (tests, docs, mobile apps) skip it.
 */
export function needsProductionTypecheck(files) {
  return files.some(
    file =>
      PRODUCTION_TYPECHECK_TRIGGERS.some(pattern => pattern.test(file)) ||
      (PRODUCTION_PROGRAM_ROOTS.test(file) && !OUTSIDE_PRODUCTION_PROGRAM.test(file))
  );
}

/** Anything other than a readable pull request diff runs the check (fail closed). */
export function decide({ baseSha, listChangedFiles }) {
  if (!baseSha) return { run: true, reason: 'not a pull request' };
  let files;
  try {
    files = listChangedFiles(baseSha);
  } catch {
    return { run: true, reason: 'changed files unavailable' };
  }
  if (files.length === 0) return { run: true, reason: 'empty diff' };
  return needsProductionTypecheck(files)
    ? { run: true, reason: 'production program or build toolchain changed' }
    : { run: false, reason: 'nothing in the production program changed' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const decision = decide({
    baseSha: process.env.BASE_SHA ?? '',
    listChangedFiles: base =>
      // -z: git otherwise quotes paths with special characters, which would hide them from the patterns.
      execFileSync('git', ['diff', '--name-only', '-z', `${base}...HEAD`], { encoding: 'utf8' })
        .split('\0')
        .filter(Boolean),
  });
  console.log(`production build typecheck: ${decision.run ? 'run' : 'skip'} (${decision.reason})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${decision.run}\n`);
}
