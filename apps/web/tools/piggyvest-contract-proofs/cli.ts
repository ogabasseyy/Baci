import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_EVIDENCE_DIR_FROM_REPO_ROOT,
  ENV_API_KEY,
  ENV_API_KEY_FALLBACK,
  ENV_BANK_ACCOUNT,
  ENV_BANK_CODE,
  ENV_BASE_URL,
  ENV_BUSINESS_WALLET,
} from './constants';
import { parseRunConfig } from './run-mode';
import { type RunDeps, runHarness } from './runner';
import { HarnessRefusal } from './safety-guards';

/**
 * PiggyVest sandbox contract-proof harness.
 *
 * Run from apps/web (the typed client imports `server-only`, hence the condition):
 *
 *   NODE_OPTIONS=--conditions=react-server node_modules/.bin/tsx \
 *     tools/piggyvest-contract-proofs/cli.ts [mode] [options]
 */

export const USAGE = `PiggyVest sandbox contract-proof harness

Modes (exactly one; default is --dry-run):
  --dry-run                  mocks only, no network, prints mock output, writes nothing
  --live-readonly            GET requests only against staging.piggyvest.business
  --live-sandbox-mutations   journaled sandbox mutations on allowlisted QA customers

Options:
  --allowlist <file>         JSON {"qaCustomerIds": [...]}; required for both live modes
  --qa-customer <id>         use this allowlisted QA customer (default: first entry)
  --journal <file>           mutation journal (default: ~/.baci/piggyvest-contract-proofs/journal.jsonl)
  --evidence-dir <dir>       default: docs/piggyvest-contract-evidence (live modes only)
  --new-attempt              open fresh mutation slots; a plain re-run never resends
  --help

Environment:
  ${ENV_API_KEY}   sandbox test key (test_key_...); fallback ${ENV_API_KEY_FALLBACK}
  ${ENV_BASE_URL}  optional; must be exactly https://staging.piggyvest.business
  ${ENV_BANK_CODE}, ${ENV_BANK_ACCOUNT}  sandbox bank destination for the bank-outflow step
  ${ENV_BUSINESS_WALLET}  Ogabassey business SANDBOX wallet id for proof 7 (interest payout target)
`;

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

export function defaultEvidenceDir(): string {
  // apps/web/tools/piggyvest-contract-proofs -> repository root is four levels up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../..', DEFAULT_EVIDENCE_DIR_FROM_REPO_ROOT);
}

const processIo: CliIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

export async function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  io: CliIo = processIo,
  deps: RunDeps = {}
): Promise<number> {
  try {
    const config = parseRunConfig(argv, env);
    if (config.help) {
      io.out(USAGE);
      return 0;
    }
    const summary = await runHarness(config, {
      print: io.out,
      defaultEvidenceDir: defaultEvidenceDir(),
      ...deps,
    });
    io.out(`Mode: ${summary.mode}`);
    for (const proof of summary.proofs)
      io.out(`${proof.proof}: ${proof.status}`);
    if (summary.evidence) {
      io.out(`Evidence written: ${summary.evidence.markdownPath}`);
      io.out(`Evidence written: ${summary.evidence.jsonPath}`);
    }
    return summary.exitCode;
  } catch (error) {
    if (error instanceof HarnessRefusal) {
      io.err(error.message);
      return 2;
    }
    // Unexpected errors can carry request or response text: withhold it.
    io.err('Harness stopped on an unexpected error; details withheld.');
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code;
  });
}
