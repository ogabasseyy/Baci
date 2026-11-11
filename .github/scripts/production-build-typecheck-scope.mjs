import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The production build type check differs from the normal typecheck only through
 * toolchain and configuration: the scripts, the tsconfig files, the typed-route
 * preparation, the Next config and version, and the workflow that runs it. Source
 * changes are already covered by the normal typecheck over a superset of the same
 * files, so pull requests that touch none of these skip the second full pass.
 */
export const PRODUCTION_TYPECHECK_TRIGGERS = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^turbo\.json$/,
  /^tsconfig[^/]*\.json$/,
  /^patches\//,
  /^apps\/web\/package\.json$/,
  /^apps\/web\/tsconfig[^/]*\.json$/,
  /^apps\/web\/next\.config[^/]*$/,
  /^apps\/web\/tools\/prepare-typed-navigation[^/]*$/,
  /^apps\/web\/src\/config\/build-typecheck\.ts$/,
  /^\.github\/workflows\/ci\.yml$/,
  /^\.github\/actions\//,
  /^\.github\/scripts\/production-(?:build-)?typecheck-scope[^/]*$/,
];

export function needsProductionTypecheck(files) {
  return files.some(file => PRODUCTION_TYPECHECK_TRIGGERS.some(pattern => pattern.test(file)));
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
    ? { run: true, reason: 'build toolchain or configuration changed' }
    : { run: false, reason: 'no build toolchain or configuration change' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const decision = decide({
    baseSha: process.env.BASE_SHA ?? '',
    listChangedFiles: base =>
      execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean),
  });
  console.log(`production build typecheck: ${decision.run ? 'run' : 'skip'} (${decision.reason})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${decision.run}\n`);
}
