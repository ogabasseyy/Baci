import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { coreObservationManifestSchema } from '../src/schemas/core-observation-manifest.ts';
import { parseStrictJson } from '../src/strict-json-parser.ts';

const MAX_MANIFEST_BYTES = 1_048_576;

/** @returns {never} */
function invalidManifest() {
  throw new Error('Invalid observation manifest');
}

/**
 * @param {unknown} input
 * @returns {import('../src/schemas/core-observation-manifest.ts').ChowdeckCoreObservationManifestV1}
 */
export function validateCoreObservationManifest(input) {
  try {
    return coreObservationManifestSchema.parse(input);
  } catch {
    return invalidManifest();
  }
}

/**
 * @template T
 * @param {{
 *   driver: {
 *     setEcho: (enabled: boolean) => Promise<unknown>;
 *     readSecrets: () => Promise<{apiKey: Buffer; merchantReference: Buffer}>;
 *     installSignalHandler: (handler: () => void) => () => void;
 *   };
 *   action: (secrets: {apiKey: Buffer; merchantReference: Buffer}, signal: AbortSignal) => Promise<T>;
 * }} options
 * @returns {Promise<T>}
 */
export async function runHiddenInputSession(options) {
  let secrets;
  const controller = new AbortController();
  const interrupted = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true });
  });
  /** @type {() => void} */
  let removeSignalHandler = () => undefined;
  let cleanupFailed = false;
  try {
    await options.driver.setEcho(false);
    removeSignalHandler = options.driver.installSignalHandler(() => controller.abort());
    const input = options.driver.readSecrets().then((value) => {
      if (controller.signal.aborted) {
        value.apiKey.fill(0);
        value.merchantReference.fill(0);
      } else {
        secrets = value;
      }
      return value;
    });
    secrets = /** @type {{apiKey: Buffer; merchantReference: Buffer}} */ (await Promise.race([input, interrupted]));
    if (controller.signal.aborted) throw new Error('interrupted');
    return /** @type {T} */ (await Promise.race([options.action(secrets, controller.signal), interrupted]));
  } catch {
    throw new Error('Observation failed');
  } finally {
    try { removeSignalHandler(); } catch { cleanupFailed = true; }
    secrets?.apiKey.fill(0);
    secrets?.merchantReference.fill(0);
    try { await options.driver.setEcho(true); } catch { cleanupFailed = true; }
    if (cleanupFailed) throw new Error('Observation failed');
  }
}

/**
 * @param {string[]} argv
 * @returns {{manifestPath: string; outputPath: string}}
 */
function parseArguments(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  if (
    args.length !== 4 ||
    args[0] !== '--manifest' ||
    args[1]?.length === 0 ||
    args[2] !== '--out' ||
    args[3]?.length === 0
  ) {
    throw new Error('Observation failed');
  }
  return { manifestPath: args[1], outputPath: args[3] };
}

/**
 * @param {{
 *   argv: string[];
 *   readManifest: (path: string, encoding: 'utf8') => Promise<string>;
 *   openTty: () => Promise<unknown>;
 *   fetchImpl: typeof fetch;
 *   writeOutput: (path: string, content?: string) => Promise<void>;
 * }} options
 * @returns {Promise<{code: 'BLOCKED_CONTRACT_EVIDENCE'}>}
 */
export async function runObserveCoreCli(options) {
  try {
    const { manifestPath } = parseArguments(options.argv);
    const serialized = await options.readManifest(manifestPath, 'utf8');
    if (Buffer.byteLength(serialized, 'utf8') > MAX_MANIFEST_BYTES) {
      throw new Error('unsafe manifest');
    }
    const manifest = validateCoreObservationManifest(parseStrictJson(serialized));
    if (manifest.readiness === 'blocked_contract_evidence') {
      return { code: 'BLOCKED_CONTRACT_EVIDENCE' };
    }
    throw new Error('unsupported observation state');
  } catch (error) {
    if (error instanceof Error && error.message === 'Observation failed') {
      throw error;
    }
    throw new Error('Observation failed');
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  try {
    const result = await runObserveCoreCli({
      argv: process.argv.slice(2),
      readManifest: readFile,
      openTty: async () => {
        throw new Error('disabled');
      },
      fetchImpl: fetch,
      writeOutput: async () => {
        throw new Error('disabled');
      },
    });
    console.error(result.code);
    process.exitCode = 2;
  } catch {
    console.error('Observation failed');
    process.exitCode = 1;
  }
}
