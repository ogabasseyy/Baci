import { pathToFileURL } from 'node:url';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';
import { readStorefrontEdgeInventory } from './read-storefront-edge-inventory';
import { canonicalizeStorefrontEdgeInventoryValue } from './storefront-edge-canonical-json';
import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';

type ValidationOptions = Readonly<{
  expectedOriginMainSha: string;
  expectedPilotCandidateHostnames: readonly string[];
  expectedPosthogRelayPath?: string;
  inputPath: string;
  repoRoot: string;
}>;

/** Rejects any Task 1A artifact that does not match the checked-out source tree. */
export async function validateStorefrontEdgeInventory(
  options: ValidationOptions
) {
  const artifact = await readStorefrontEdgeInventory(options.inputPath);
  const expectedOriginMainSha = options.expectedOriginMainSha
    .trim()
    .toLowerCase();
  if (artifact.originMainSha !== expectedOriginMainSha)
    throw new Error('inventory origin authority does not match origin/main');
  let regenerated: StorefrontEdgeInventory;
  try {
    regenerated = await createStorefrontEdgeInventory({
      originMainSha: expectedOriginMainSha,
      pilotCandidateHostnames: options.expectedPilotCandidateHostnames,
      posthogRelayPath: options.expectedPosthogRelayPath ?? '/baci-relay',
      repoRoot: options.repoRoot,
    });
  } catch (error) {
    throw new Error('inventory regeneration failed', { cause: error });
  }
  if (
    canonicalizeStorefrontEdgeInventoryValue(artifact) !==
    canonicalizeStorefrontEdgeInventoryValue(regenerated)
  )
    throw new Error(
      'inventory artifact does not match the canonical source tree'
    );
  return {
    inventorySha256: regenerated.inventorySha256,
    rowCount: regenerated.rows.length,
    storefrontEntrypointCount: new Set(
      regenerated.rows
        .filter(({ sourceKind }) => sourceKind === 'storefront_entrypoint')
        .map(({ sourcePath }) => sourcePath)
        .filter((sourcePath): sourcePath is string => Boolean(sourcePath))
    ).size,
  };
}

function parseArguments(args: readonly string[]) {
  const allowedOptions = new Set([
    '--input',
    '--pilot-hostname',
    '--posthog-relay-path',
    '--repo-root',
    '--source-sha',
  ]);
  const values = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (
      !option ||
      !allowedOptions.has(option) ||
      !value ||
      (option !== '--pilot-hostname' && values.has(option))
    )
      throw new Error('inventory validation options are invalid');
    values.set(option, [...(values.get(option) ?? []), value]);
  }
  const repoRoot = values.get('--repo-root')?.[0];
  const inputPath = values.get('--input')?.[0];
  const expectedOriginMainSha = values.get('--source-sha')?.[0];
  const expectedPilotCandidateHostnames = values.get('--pilot-hostname') ?? [];
  const expectedPosthogRelayPath = values.get('--posthog-relay-path')?.[0];
  if (
    !repoRoot ||
    !inputPath ||
    !expectedOriginMainSha ||
    !expectedPosthogRelayPath ||
    expectedPilotCandidateHostnames.length === 0
  )
    throw new Error(
      'inventory validation requires --repo-root, --input, --source-sha, --pilot-hostname, and --posthog-relay-path'
    );
  return {
    expectedOriginMainSha,
    expectedPilotCandidateHostnames,
    expectedPosthogRelayPath,
    inputPath,
    repoRoot,
  };
}

async function runCli(args: readonly string[]) {
  const result = await validateStorefrontEdgeInventory(parseArguments(args));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
