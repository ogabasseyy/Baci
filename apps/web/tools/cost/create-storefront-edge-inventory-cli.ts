import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';

function parseArguments(args: readonly string[]) {
  const allowedOptions = new Set([
    '--output',
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
      throw new Error('inventory options are invalid');
    values.set(option, [...(values.get(option) ?? []), value]);
  }
  const repoRoot = values.get('--repo-root')?.[0];
  const originMainSha = values.get('--source-sha')?.[0];
  const output = values.get('--output')?.[0];
  const posthogRelayPath = values.get('--posthog-relay-path')?.[0];
  const pilotCandidateHostnames = values.get('--pilot-hostname') ?? [];
  if (
    !repoRoot ||
    !originMainSha ||
    !output ||
    !posthogRelayPath ||
    pilotCandidateHostnames.length === 0
  )
    throw new Error(
      'inventory requires --repo-root, --source-sha, --output, --pilot-hostname, and --posthog-relay-path'
    );
  return {
    options: {
      originMainSha,
      pilotCandidateHostnames,
      posthogRelayPath,
      repoRoot,
    },
    output,
  };
}

/** CLI entry for regenerating the Task 1A storefront edge inventory artifact. */
export async function runCreateStorefrontEdgeInventoryCli(
  args: readonly string[]
) {
  const { options, output } = parseArguments(args);
  const inventory = await createStorefrontEdgeInventory(options);
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), `${JSON.stringify(inventory, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({ inventorySha256: inventory.inventorySha256, rowCount: inventory.rows.length })}\n`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCreateStorefrontEdgeInventoryCli(process.argv.slice(2)).catch(
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.stack : String(error)}\n`
      );
      process.exitCode = 1;
    }
  );
}
