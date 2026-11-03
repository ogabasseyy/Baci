// Transitive reading for the storefront release gate: a workflow or action can
// hand the build, upload or dispatch to a script it runs, so the gate scans the
// scripts a file references (and theirs) as part of that file. A script under
// .github that cannot be read fails closed, because the gate cannot see what
// it does.
import path from 'node:path';

const SCRIPT_REFERENCE = /[\w@./-]+\.(?:sh|bash|zsh|mjs|cjs|js|ts|py|rb|rake)\b/g;
// Extensionless scripts. Executed: the argument of bash/sh/zsh/source or a
// ./relative command, which fail closed under .github/ when unreadable. Bare:
// a command path through a scripts/ or .github/ directory, followed only when
// it resolves to a file (it may just as well be a directory or a glob).
const EXECUTED_REFERENCE = new RegExp(
  [
    String.raw`(?:^|[\s;&|(])(?:bash|sh|zsh|source|exec)\s+(?!-)["']?([\w@./-]*[\w@-])`,
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
const WORKING_DIRECTORY = /^\s*(?:-\s+)?working-directory:\s*(\S+)\s*$/gm;
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
  const visit = (source, depth) => {
    if (depth > MAX_DEPTH) return;
    const directories = [...source.matchAll(WORKING_DIRECTORY)].map((match) => match[1].replace(/\/$/, ''));
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
    const references = [
      ...[...source.matchAll(SCRIPT_REFERENCE)].map((match) => [match[0], true]),
      ...[...source.matchAll(EXECUTED_REFERENCE)].map((match) => [match[1] ?? match[2], true]),
      ...[...source.matchAll(BARE_REFERENCE)].map((match) => [match[1], false]),
    ].filter(([reference]) => !HAS_EXTENSION.test(reference) || SCRIPT_REFERENCE_ONLY.test(reference));
    for (const [reference, executed] of references) {
      // Actions and workflows are followed through `uses:` above.
      if (/^(?:\.\/)?\.github\/(?:actions|workflows)\//.test(reference)) continue;
      const found = candidates(reference, directories).find((file) => readFile(file) !== undefined);
      if (found === undefined) {
        const normalized = reference.replace(/^\.\//, '');
        if (executed && normalized.startsWith('.github/') && !missing.includes(normalized)) missing.push(normalized);
        continue;
      }
      if (seen.has(found) || GATE_OWN_FILE.test(found) || TEST_FILE.test(found)) continue;
      seen.add(found);
      const content = readFile(found).replace(COMMENT_LINE, '');
      parts.push(content);
      visit(content, depth + 1);
    }
  };
  visit(text, 0);
  return { text: parts.join('\n'), missing };
}
