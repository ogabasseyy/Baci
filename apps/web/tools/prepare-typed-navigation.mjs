import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const original =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Match literal generated TypeScript syntax.
  '    | (T extends `${DynamicRoutes<infer _>}${Suffix}` ? T : never)';
const prepared =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Match literal generated TypeScript syntax.
  '    | ([T] extends [StaticRoutes | SearchOrHash | WithProtocol | `${StaticRoutes}${SearchOrHash}`] ? never : (T extends `${DynamicRoutes<infer _>}${Suffix}` ? T : never))';

/**
 * Avoid re-inferring every dynamic pattern for an already-checked Route union.
 * This is type-equivalent: the skipped T values are already included by the
 * preceding static/search/protocol branches. Unchecked inputs retain Next's
 * original dynamic validation. Do not change the exported route signatures.
 */
export function prepareTypedNavigation(source) {
  const originalCount = source.split(original).length - 1;
  const preparedCount = source.split(prepared).length - 1;
  if (originalCount === 0 && preparedCount === 1) return source;
  if (originalCount !== 1 || preparedCount !== 0) {
    throw new Error(
      'Unsupported Next typed-route declaration; review the generated RouteImpl before typechecking.'
    );
  }
  return source.replace(original, prepared);
}

/**
 * Prepare the generated declaration at `path`. With `outputPath`, the source
 * stays untouched and the prepared copy is written there instead: `next build`
 * regenerates `.next/types/link.d.ts` before its own type check, so the
 * production build reads a copy that the build cannot overwrite.
 */
export async function prepareTypedNavigationFile(path, outputPath = path) {
  const source = await readFile(path, 'utf8');
  const output = prepareTypedNavigation(source);
  if (outputPath !== path) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, 'utf8');
    return;
  }
  if (output !== source) await writeFile(path, output, 'utf8');
}

/** Read the optional `--output <path>` argument; anything else fails closed. */
export function parseOutputArgument(args) {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === '--output' && args[1]) return args[1];
  throw new Error('Usage: prepare-typed-navigation.mjs [--output <path>]');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const output = parseOutputArgument(process.argv.slice(2));
  await prepareTypedNavigationFile(
    resolve('.next/types/link.d.ts'),
    output ? resolve(output) : undefined
  );
}
