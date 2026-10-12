import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exerciseContract } from './exercise-contract.mjs';

export async function runContractCommand({
  run = exerciseContract,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const report = await run();
    const { entries: _entries, ...sourceManifest } = report.sourceManifest;
    stdout.write(`${JSON.stringify({ ...report, sourceManifest }, null, 2)}\n`);
    return 0;
  } catch {
    stderr.write(
      'Synthetic contract E2E failed; provider bodies and SQL output withheld.\n'
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await runContractCommand();
