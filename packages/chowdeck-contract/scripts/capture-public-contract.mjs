import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { digestArtifact } from '../src/canonical-artifact-digest.ts';
import { capturePublicContract } from '../src/capture-public-contract.ts';

const DEFAULT_OUTPUT_URL = new URL(
  '../evidence/0a-core/public-contract.json',
  import.meta.url,
);
const SOURCE_MANIFEST_URL = new URL(
  '../config/public-document-sources.json',
  import.meta.url,
);
const CAPTURE_TOOL_DIGEST = digestArtifact({
  captureTool: '@baci/chowdeck-contract',
  captureToolVersion: 2,
});

/** @param {string[]} argv */
function outputPath(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  if (args.length === 0) return fileURLToPath(DEFAULT_OUTPUT_URL);
  if (args.length === 2 && args[0] === '--output' && args[1]?.length > 0) {
    return args[1];
  }
  if (
    args.length === 4 &&
    args[0] === '--sources' &&
    args[1] === 'config/public-document-sources.json' &&
    args[2] === '--out' &&
    args[3]?.length > 0
  ) {
    return join(args[3], 'public-contract.json');
  }
  throw new Error('Invalid capture arguments');
}

/**
 * @param {{
 *   argv: string[];
 *   now: () => Date;
 *   fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
 * }} options
 */
export async function runCaptureCli(options) {
  const destination = outputPath(options.argv);
  const serializedManifest = await readFile(SOURCE_MANIFEST_URL, 'utf8');
  const sources = JSON.parse(serializedManifest);
  const capturedAt = options.now();
  capturedAt.setUTCMilliseconds(0);
  return capturePublicContract({
    sources,
    capturedAt: capturedAt.toISOString(),
    captureToolDigest: CAPTURE_TOOL_DIGEST,
    outputPath: destination,
    fetchImpl: options.fetchImpl,
  });
}

if (
  process.argv[1] !== undefined &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  try {
    await runCaptureCli({
      argv: process.argv.slice(2),
      now: () => new Date(),
      fetchImpl: fetch,
    });
  } catch {
    console.error('Public contract capture failed.');
    process.exitCode = 1;
  }
}
