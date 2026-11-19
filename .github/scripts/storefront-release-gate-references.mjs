// Transitive reading for the storefront release gate: a workflow or action can
// hand the build, upload or dispatch to a script it runs, so the gate scans the
// scripts a file references (and theirs) as part of that file. A script under
// .github that cannot be read fails closed, because the gate cannot see what
// it does.
import path from 'node:path';
import { scriptInvocations, STOREFRONT_DIR } from './storefront-release-gate-scripts.mjs';

const SCRIPT_REFERENCE = /[\w@./-]+\.(?:sh|bash|zsh|mjs|cjs|js|ts|py|rb|rake)\b/g;
// Extensionless scripts. Executed: the argument of bash/sh/zsh/source or a
// ./relative command, which fail closed under .github/ when unreadable. Bare:
// a command path through a scripts/ or .github/ directory, followed only when
// it resolves to a file (it may just as well be a directory or a glob).
const EXECUTED_REFERENCE = new RegExp(
  [
    String.raw`(?:^|[\s;&|(])(?:bash|sh|zsh|source|exec)\s+(?:-[\w-]+\s+(?:(?:pipefail|errexit|nounset|xtrace|posix)\s+)?)*["']?([\w@./-]*[\w@-])`,
    String.raw`(?:^|[\s;&|("'])(\.\/[\w@./-]*[\w@-])`,
  ].join('|'),
  'gm'
);
const BARE_REFERENCE = /(?:^|[\s;&|("'])((?:\.github|(?:[\w@.-]+(?:\/[\w@.-]+)*\/)?scripts)\/[\w@./-]*[\w@-])(?=[\s;&|)"']|$)/gm;
// A name with an extension that SCRIPT_REFERENCE does not know (.json, .yml, .rb
// data) is not a script.
const HAS_EXTENSION = /\.\w+$/;
const SCRIPT_REFERENCE_ONLY = /\.(?:sh|bash|zsh|mjs|cjs|js|ts|py|rb|rake)$/;
const LOCAL_USES = /^\s*(?:-\s+)?uses:\s*['"]?\.\/(\.github\/(?:actions|workflows)\/[^\s'"#]+?)\/?['"]?\s*(?:#.*)?$/gm;
const WORKING_DIRECTORY = /^\s*(?:-\s+)?working-directory:\s*(.+?)\s*$/gm;
const ENV_EXPRESSION = /\$\{\{\s*env\.(\w+)\s*\}\}/g;

// `${{ env.NAME }}` becomes the literal value the same file gives NAME.
function resolveEnvExpression(value, source) {
  return value.replace(ENV_EXPRESSION, (whole, name) => {
    const literal = source.match(new RegExp(`^\\s*${name}:\\s*['"]?([^\\s'"#]+)['"]?\\s*(?:#.*)?$`, 'm'));
    return literal ? literal[1] : whole;
  });
}
// The gate's own modules and every test file describe shipping commands as
// data and are run only to check code, so they are not followed.
const GATE_OWN_FILE = /^\.github\/scripts\/storefront-release-gate(?:-[\w-]+)?\.mjs$/;
const TEST_FILE = /(?:^|\/)(?:[\w.-]*\.(?:test|spec)\.\w+|[\w.-]*_test\.\w+|test_[\w.-]+)$|(?:^|\/)__tests__\//;
// Comment lines run nothing, so a word in a comment does not make a script ship.
const COMMENT_LINE = /^\s*(?:#|\/\/).*$/gm;
const MAX_DEPTH = 6;

function candidates(reference, directories) {
  const cleaned = path.posix.normalize(reference.replace(/^\.\//, ''));
  if (cleaned.startsWith('../') || path.posix.isAbsolute(cleaned)) return [];
  return [cleaned, ...directories.map((directory) => path.posix.join(directory, cleaned))];
}

/**
 * `text` joined with every script it references, transitively, plus the
 * `.github` references that could not be read.
 */
export function expandReferences(text, readFile) {
  const seen = new Set();
  const missing = [];
  const parts = [text];
  // Parts that came from the storefront package or its directory: they ship the
  // storefront even when their own text never names the app.
  const scopedParts = [];
  const inStorefront = (directory) => directory === STOREFRONT_DIR || directory?.startsWith(`${STOREFRONT_DIR}/`);
  const visit = (source, depth, base = []) => {
    if (depth > MAX_DEPTH) {
      const label = `a reference chain deeper than ${MAX_DEPTH} levels`;
      if (!missing.includes(label)) missing.push(label);
      return;
    }
    const directories = [...base, ...[...source.matchAll(WORKING_DIRECTORY)].map((match) => resolveEnvExpression(match[1], source).replace(/\/$/, ''))];
    // A caller workflow and the local action or reusable workflow it uses run
    // as one unit, so shipping split across the two files is still seen.
    for (const [, used] of source.matchAll(LOCAL_USES)) {
      const found = [used, `${used}/action.yml`, `${used}/action.yaml`].find(
        (file) => /\.ya?ml$/.test(file) && readFile(file) !== undefined
      );
      if (found === undefined) {
        if (!missing.includes(used)) missing.push(used);
        continue;
      }
      if (seen.has(found)) continue;
      seen.add(found);
      const content = readFile(found).replace(COMMENT_LINE, '');
      parts.push(content);
      visit(content, depth + 1);
    }
    // `pnpm run x`, `npm run x`, `turbo run x` and `make x` hand the work to a script body.
    const invoked = scriptInvocations(source, directories, readFile);
    for (const label of invoked.missing) if (!missing.includes(label)) missing.push(label);
    for (const { key, text: body, directory } of invoked.bodies) {
      if (seen.has(key)) continue;
      seen.add(key);
      const content = body.replace(COMMENT_LINE, '');
      parts.push(content);
      if (inStorefront(directory)) scopedParts.push(content);
      visit(content, depth + 1, directory ? [directory] : []);
    }
    const references = [
      ...[...source.matchAll(SCRIPT_REFERENCE)].map((match) => [match[0], true]),
      ...[...source.matchAll(EXECUTED_REFERENCE)].map((match) => [match[1] ?? match[2], true]),
      ...[...source.matchAll(BARE_REFERENCE)].map((match) => [match[1], false]),
    ].filter(([reference]) => !HAS_EXTENSION.test(reference) || SCRIPT_REFERENCE_ONLY.test(reference));
    for (const [reference, executed] of references) {
      // Actions and workflows are followed through `uses:` above.
      if (/^(?:\.\/)?\.github\/(?:actions|workflows)\//.test(reference)) continue;
      // Every place the reference could mean counts: the step's working directory and the root.
      const foundAll = candidates(reference, directories).filter((file) => readFile(file) !== undefined);
      if (foundAll.length === 0) {
        const normalized = reference.replace(/^\.\//, '');
        if (executed && normalized.startsWith('.github/') && !missing.includes(normalized)) missing.push(normalized);
        continue;
      }
      for (const found of foundAll) {
        if (seen.has(found) || GATE_OWN_FILE.test(found) || TEST_FILE.test(found)) continue;
        seen.add(found);
        const content = readFile(found).replace(COMMENT_LINE, '');
        parts.push(content);
        if (inStorefront(path.posix.dirname(found))) scopedParts.push(content);
        visit(content, depth + 1, [path.posix.dirname(found)]);
      }
    }
  };
  visit(text, 0);
  return { text: parts.join('\n'), scopedText: scopedParts.join('\n'), missing };
}
