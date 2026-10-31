// Server-off rule of the storefront release gate: while the gate is in place,
// every new PiggyVest storefront source file must ship with a test that proves
// it behaves exactly like production when the server keeps PiggyVest off.

export const STOREFRONT_ROOT = 'apps/mobile-storefront';
export const SERVER_OFF_TEST_SUFFIX = '.server-off.test.tsx';

const APP_PREFIX = `${STOREFRONT_ROOT}/`;
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/;
// Files that never reach the app bundle: tests and their helpers, mocks,
// type declarations, style and type-only modules, and build tooling.
const NOT_SHIPPED = [
  /\.d\.ts$/,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /\.test-(?:support|utils|fixtures)\.[cm]?[jt]sx?$/,
  /\.(?:styles|types)\.ts$/,
  /(?:^|\/)__tests__\//,
  /(?:^|\/)__mocks__\//,
];
const NOT_SHIPPED_DIRECTORIES = ['test-support/', 'scripts/', 'tools/'];
const PIGGYVEST_NAME = /piggy[-_ ]?vest/i;
const WALLET_PATH = /wallet|savings/i;

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
  return PIGGYVEST_NAME.test(text ?? '');
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

/** Each new PiggyVest file without a server-off test, with the preferred test path. */
export function findMissingServerOffTests({ newFiles, tracked, readContent }) {
  const present = new Set(tracked);
  return [...newFiles]
    .sort()
    .filter(isShippedSource)
    .filter((file) => isPiggyvestSource(file, () => readContent(file)))
    .flatMap((file) => {
      const accepted = serverOffTestPaths(file);
      return accepted.some((test) => present.has(test)) ? [] : [{ file, expected: accepted[0] }];
    });
}
