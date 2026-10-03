// Pre-start staging step for the merchant image pilot lab.
//
// Stages verified derivatives + original snapshots under <publicDir>/__pilot
// through the same validated loader the lab routes use. MUST run before
// `next start`: files added to public/ after the server starts are not
// served, so request-time staging alone would leave measured images
// unservable until a restart. Idempotent (verified-identical destinations
// are left untouched); fails closed on invalid inputs or a missing lab flag.
//
// Usage:
//   pnpm pilot:stage --input-root <dir> --output-root <dir> --public-dir <dir>
// Flags override BACI_IMAGE_PILOT_INPUT_ROOT / _OUTPUT_ROOT / _PUBLIC_DIR.
// Requires BACI_IMAGE_PILOT_LAB=1. Always invoke via the pnpm script: it
// pins a CLI-only tsconfig that stubs `server-only` (which throws outside
// React Server Components) so this file can reuse the exact request-time
// staging loader instead of duplicating its validation.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stageLabConfigFromText } from '@/app/pilot-lab/lab-route';

export function parseStageArgs(argv: readonly string[]): {
  inputRoot?: string;
  outputRoot?: string;
  publicDir?: string;
} {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (
      (flag === '--input-root' ||
        flag === '--output-root' ||
        flag === '--public-dir') &&
      argv[i + 1] !== undefined
    ) {
      args[flag.slice(2)] = argv[i + 1] as string;
      i += 1;
    }
  }
  return {
    inputRoot: args['input-root'],
    outputRoot: args['output-root'],
    publicDir: args['public-dir'],
  };
}

export async function main(): Promise<void> {
  const flags = parseStageArgs(process.argv.slice(2));
  if (flags.inputRoot !== undefined) {
    process.env.BACI_IMAGE_PILOT_INPUT_ROOT = flags.inputRoot;
  }
  if (flags.outputRoot !== undefined) {
    process.env.BACI_IMAGE_PILOT_OUTPUT_ROOT = flags.outputRoot;
  }
  if (flags.publicDir !== undefined) {
    process.env.BACI_IMAGE_PILOT_PUBLIC_DIR = flags.publicDir;
  }
  const inputRoot = process.env.BACI_IMAGE_PILOT_INPUT_ROOT;
  const outputRoot = process.env.BACI_IMAGE_PILOT_OUTPUT_ROOT;
  if (!inputRoot || !outputRoot) {
    throw new Error(
      'merchant image pilot: set BACI_IMAGE_PILOT_INPUT_ROOT and BACI_IMAGE_PILOT_OUTPUT_ROOT to stage the lab routes'
    );
  }
  const publicDir =
    process.env.BACI_IMAGE_PILOT_PUBLIC_DIR ?? join(process.cwd(), 'public');
  // The sanctioned writer: same validated loader as the routes, with
  // staging enabled. Request-time loads stay read-only and fail closed
  // when these bytes are missing or drifted.
  const config = await stageLabConfigFromText({
    acceptancesText: await readFile(
      join(outputRoot, 'acceptances.json'),
      'utf8'
    ),
    inputRoot,
    inventoryText: await readFile(join(inputRoot, 'inventory.json'), 'utf8'),
    outputRoot,
    publicDir,
  });
  const accepted = config.statuses.filter(
    (status) => status.status === 'accepted' && status.generationId
  );
  console.log(
    JSON.stringify(
      {
        acceptedBindings: accepted.length,
        baseUrl: config.baseUrl,
        generationIds: accepted.map((status) => status.generationId),
        ok: true,
      },
      null,
      2
    )
  );
}

const isMain = process.argv[1]?.endsWith('merchant-image-pilot-stage.cli.ts');
if (isMain) {
  main().then(
    () => undefined,
    (error: unknown) => {
      console.log(
        JSON.stringify({
          error: String(error).slice(0, 300),
          ok: false,
        })
      );
      process.exitCode = 1;
    }
  );
}
