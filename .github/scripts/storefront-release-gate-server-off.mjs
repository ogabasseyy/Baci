// Server-off rule of the storefront release gate: while the gate is in place,
// every new PiggyVest storefront source file must ship with a test that imports
// it and proves it behaves exactly like production when the server keeps
// PiggyVest off.
import path from 'node:path';

export const STOREFRONT_ROOT = 'apps/mobile-storefront';
export const SERVER_OFF_TEST_SUFFIX = '.server-off.test.tsx';

const APP_PREFIX = `${STOREFRONT_ROOT}/`;
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/;
// Files that never reach the app bundle: tests and their helpers, mocks,
// type declarations, style and type-only modules, and build tooling.
const NOT_SHIPPED = [
  /\.d\.ts$/,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /[.-]test-(?:support|utils|fixtures?|harness)\.[cm]?[jt]sx?$/,
  /\.(?:styles|types)\.ts$/,
  /(?:^|\/)__tests__\//,
  /(?:^|\/)__mocks__\//,
];
const NOT_SHIPPED_DIRECTORIES = ['test-support/', 'scripts/', 'tools/'];
const PIGGYVEST_NAME = /piggy[-_ ]?vest/i;
const WALLET_PATH = /wallet|savings|goals?\b|(?:^|\/)spend/i;
// Code that uses wallet, savings or goal helpers (useWalletPinProof, SavingsGoalCard) is PiggyVest code whatever its path.
const WALLET_CODE = /\b(?:use)?(?:Wallet|Savings|Goals?)[A-Z]\w*/;

/** True for storefront source that is bundled into the app. */
export function isShippedSource(path) {
  if (!path.startsWith(APP_PREFIX) || !SOURCE_EXTENSION.test(path)) return false;
  const relative = path.slice(APP_PREFIX.length);
  if (NOT_SHIPPED_DIRECTORIES.some((directory) => relative.startsWith(directory))) return false;
  return !NOT_SHIPPED.some((pattern) => pattern.test(relative));
}

/**
 * PiggyVest files are those named after PiggyVest, any wallet or savings path
 * (PiggyVest backs the wallet and goals), and any code that mentions PiggyVest.
 * `content` may be a string or a function returning one, so the file is only
 * read when its path does not already decide the answer.
 */
export function isPiggyvestSource(path, content) {
  const relative = path.startsWith(APP_PREFIX) ? path.slice(APP_PREFIX.length) : path;
  if (PIGGYVEST_NAME.test(relative) || WALLET_PATH.test(relative)) return true;
  const text = typeof content === 'function' ? content() : content;
  return PIGGYVEST_NAME.test(text ?? '') || WALLET_CODE.test(text ?? '');
}

/**
 * Accepted server-off test locations, preferred first: next to the file, or
 * the mirrored path under __tests__/. Expo Router screens under app/ keep
 * their tests under __tests__/app/, so only the mirror counts for them.
 */
export function serverOffTestPaths(path) {
  const relative = path.slice(APP_PREFIX.length).replace(SOURCE_EXTENSION, '');
  const mirrored = `${APP_PREFIX}__tests__/${relative}${SERVER_OFF_TEST_SUFFIX}`;
  if (relative.startsWith('app/')) return [mirrored];
  return [`${APP_PREFIX}${relative}${SERVER_OFF_TEST_SUFFIX}`, mirrored];
}

// Static imports, re-exports, side-effect imports, require() and import().
const MODULE_SPECIFIER =
  /\b(?:from\s*|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\1/gm;
// `import type ...` and `export type ... from` load nothing at runtime.
const TYPE_ONLY = /\b(?:import|export)\s+type\b[\s\S]*?\bfrom\s*(['"])[^'"\n]+\1/g;
const COMMENT = /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm;

function withoutExtension(file) {
  return file.replace(SOURCE_EXTENSION, '');
}

/** True when the test file imports `source`, through a relative or `@/` specifier. */
export function importsModule(testPath, testContent, source) {
  const target = withoutExtension(source);
  const accepted = new Set([target, ...(path.posix.basename(target) === 'index' ? [path.posix.dirname(target)] : [])]);
  for (const match of (testContent ?? '').replace(COMMENT, '').replace(TYPE_ONLY, '').matchAll(MODULE_SPECIFIER)) {
    const specifier = match[2];
    let resolved;
    if (specifier.startsWith('@/')) resolved = `${APP_PREFIX}${specifier.slice(2)}`;
    else if (specifier.startsWith('./') || specifier.startsWith('../')) {
      resolved = path.posix.join(path.posix.dirname(testPath), specifier);
    }
    if (resolved !== undefined && accepted.has(withoutExtension(path.posix.normalize(resolved)))) return true;
  }
  return false;
}

const SKIPPED_BLOCK =
  /(?<![\w.$])(?:(?:it|test)\s*\.\s*(?:skip|todo)|describe\s*\.\s*(?:skip|todo)|xit|xtest|xdescribe)\s*\(/g;
const LIVE_TEST = /(?<![\w.$])(?:it|test)\s*(?:\.\s*(?:only|concurrent|each|failing)\b[^(]*)?\(/g;
const ASSERTION = /(?<![\w.$])expect\s*(?:\.\s*assertions?\s*)?\(|(?<![\w.$])assert\s*(?:\.\s*\w+)?\s*\(|\.(?:should|toMatchSnapshot)\b/;

// The index after the parenthesis that closes the one just before `from`, skipping strings.
function callEnd(code, from) {
  let depth = 1;
  let quote = '';
  let at = from;
  for (; at < code.length && depth > 0; at += 1) {
    const char = code[at];
    if (quote) {
      if (char === '\\') at += 1;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
  }
  return at;
}

// Removes the whole call of every skipped or todo test or suite, so nothing inside it counts.
function withoutSkipped(code) {
  let result = '';
  let from = 0;
  for (const match of code.matchAll(SKIPPED_BLOCK)) {
    if (match.index < from) continue;
    result += code.slice(from, match.index);
    from = callEnd(code, match.index + match[0].length);
  }
  return result + code.slice(from);
}

/**
 * True when the test file declares a test that is not skipped or todo and
 * asserts inside its own body: an import with a skipped or empty test proves
 * nothing, and neither does an assertion outside every live test.
 */
export function hasLiveAssertion(testContent) {
  const code = withoutSkipped((testContent ?? '').replace(COMMENT, ''));
  return [...code.matchAll(LIVE_TEST)].some((match) => {
    let end = callEnd(code, match.index + match[0].length);
    // it.each(table)(name, body) is two calls.
    while (/^\s*\(/.test(code.slice(end))) end = callEnd(code, end + code.slice(end).indexOf('(') + 1);
    return ASSERTION.test(code.slice(match.index, end));
  });
}

/**
 * Each new PiggyVest file without a server-off test that imports it and runs a live assertion, with the
 * preferred test path, plus `test` when a test exists but does not import it.
 */
export function findMissingServerOffTests({ newFiles, tracked, readContent }) {
  const present = new Set(tracked);
  return [...newFiles]
    .sort()
    .filter(isShippedSource)
    .filter((file) => isPiggyvestSource(file, () => readContent(file)))
    .flatMap((file) => {
      const accepted = serverOffTestPaths(file);
      const existing = accepted.filter((test) => present.has(test));
      const covers = (test) => {
        const content = readContent(test);
        return importsModule(test, content, file) && hasLiveAssertion(content);
      };
      if (existing.some(covers)) return [];
      return [existing.length === 0 ? { file, expected: accepted[0] } : { file, expected: accepted[0], test: existing[0] }];
    });
}
