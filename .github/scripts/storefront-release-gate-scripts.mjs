// Package-script and make-target reading for the storefront release gate: a
// workflow can hand shipping to `pnpm run <script>`, `npm run`, `yarn`,
// `turbo run` or `make`, whose bodies live in package.json or a Makefile. The
// gate follows the script bodies; an invocation scoped to the storefront
// that it cannot resolve is reported, so the gate fails closed.
import path from 'node:path';

export const STOREFRONT_DIR = 'apps/mobile-storefront';
const STOREFRONT_SCOPE = /mobile-storefront/;
const INVOCATION = /(?:^|[\s;&|(])(pnpm|npm|yarn|bun|turbo|make)((?:[ \t]+[^\s;&|()]+)*)/gm;
// A package-manager prefix (`pnpm`, `pnpm exec`, `pnpm dlx`, `npx`, ...) before `turbo`; the flags it carries are kept.
const TURBO_WRAPPER = /(?:^|(?<=[\s;&|(]))(?:pnpm|npm|yarn|bun|npx)((?:\s+-\S+(?:\s+(?![-\s])(?!(?:exec|dlx|x|turbo)\b)\S+)?)*)(?:\s+(?:exec|dlx|x))?\s+turbo\b/g;
const VALUE_FLAGS = new Set(['--filter', '-F', '-C', '--dir', '--prefix', '--cwd', '--workspace', '-w', '--directory', '-f', '--file']);
const PATH_FLAGS = new Set(['-C', '--dir', '--prefix', '--cwd', '--directory']);
const FILTER_FLAGS = new Set(['--filter', '-F', '--workspace', '-w']);
const BUILTIN = new Set([
  'install', 'i', 'add', 'remove', 'rm', 'update', 'up', 'ci', 'exec', 'dlx', 'x', 'create', 'init', 'link', 'unlink', 'store',
  'config', 'cache', 'dedupe', 'audit', 'outdated', 'list', 'ls', 'why', 'prune', 'fetch', 'rebuild', 'patch', 'pack', 'publish',
  'version', 'view', 'help', 'login', 'logout', 'whoami', 'root', 'bin', 'env', 'setup', 'approve-builds', 'import', 'deploy',
]);
const NPM_LIFECYCLE = new Set(['test', 'start', 'stop', 'restart']);

function parseArguments(rawArguments) {
  const tokens = rawArguments.trim().split(/\s+/).filter(Boolean);
  const positional = [];
  const scopes = [];
  const directories = [];
  let recursive = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const [flag, inline] = token.startsWith('--') && token.includes('=') ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)] : [token, undefined];
    if (flag === '-r' || flag === '--recursive') recursive = true;
    if (VALUE_FLAGS.has(flag)) {
      const value = inline ?? tokens[(index += 1)] ?? '';
      if (FILTER_FLAGS.has(flag)) scopes.push(value);
      if (PATH_FLAGS.has(flag)) directories.push(value);
      continue;
    }
    if (token.startsWith('-')) continue;
    positional.push(token.replace(/^["']|["']$/g, ''));
  }
  return { positional, scopes, directories, recursive };
}

function scriptNames(tool, positional) {
  if (tool === 'make') return positional;
  if (tool === 'turbo') return positional[0] === 'run' ? positional.slice(1) : positional.slice(0, 1);
  if (['run', 'run-script', 'run-s', 'run-p'].includes(positional[0])) return positional.slice(1, 2);
  if (tool === 'npm') return NPM_LIFECYCLE.has(positional[0]) ? positional.slice(0, 1) : [];
  return positional[0] !== undefined && !BUILTIN.has(positional[0]) ? positional.slice(0, 1) : [];
}

/**
 * The package scripts and Makefiles a text invokes: `{ bodies: [{ key, text }], missing: [label] }`.
 * `directories` are the working directories declared in the text.
 */
export function scriptInvocations(rawSource, directories, readFile) {
  // A continued command is one command; `pnpm exec turbo run x` is `turbo run x`.
  const source = rawSource.replace(/\\\r?\n\s*/g, ' ').replace(TURBO_WRAPPER, ' turbo$1 ');
  const bodies = [];
  const missing = [];
  const addBody = (key, text, directory) => !bodies.some((body) => body.key === key) && bodies.push({ key, text, directory });
  const addMissing = (label) => !missing.includes(label) && missing.push(label);
  for (const [line, tool, rawArguments] of [...source.matchAll(INVOCATION)].map((match) => [match[0], match[1], match[2]])) {
    const { positional, scopes, directories: flagDirectories, recursive } = parseArguments(rawArguments);
    const names = scriptNames(tool, positional);
    if (names.length === 0) continue;
    const scoped =
      [...directories, ...flagDirectories].some((directory) => STOREFRONT_SCOPE.test(directory)) ||
      scopes.some((scope) => STOREFRONT_SCOPE.test(scope)) ||
      STOREFRONT_SCOPE.test(line);
    const cwd = [...flagDirectories, ...directories].map((directory) => directory.replace(/\/$/, ''));
    for (const name of names) {
      if (tool === 'make') {
        const found = [...cwd, ''].map((directory) => path.posix.join(directory, 'Makefile')).find((file) => readFile(file) !== undefined);
        if (found) addBody(found, readFile(found), path.posix.dirname(found) === '.' ? '' : path.posix.dirname(found));
        else if (scoped) addMissing(`Makefile target "${name}"`);
        continue;
      }
      const manifests = [
        ...(scoped || recursive || tool === 'turbo' ? [`${STOREFRONT_DIR}/package.json`] : []),
        ...cwd.map((directory) => path.posix.join(directory, 'package.json')),
        'package.json',
      ];
      let resolved = false;
      for (const manifest of new Set(manifests)) {
        const text = readFile(manifest);
        if (text === undefined) continue;
        let scripts;
        try {
          scripts = JSON.parse(text).scripts ?? {};
        } catch {
          if (scoped && manifest.startsWith(STOREFRONT_DIR)) addMissing(`${manifest} (unreadable) script "${name}"`);
          continue;
        }
        for (const candidate of [`pre${name}`, name, `post${name}`]) {
          if (typeof scripts[candidate] === 'string') {
            resolved = resolved || candidate === name;
            addBody(`${manifest}#${candidate}`, `${scripts[candidate]}\n`, path.posix.dirname(manifest) === '.' ? '' : path.posix.dirname(manifest));
          }
        }
      }
      if (!resolved && scoped) addMissing(`package script "${name}" for ${STOREFRONT_DIR}`);
    }
  }
  return { bodies, missing };
}
