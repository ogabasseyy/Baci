import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanEvidenceTree } from '../src/evidence-tree-scan.ts';

const evidenceDirectory = fileURLToPath(new URL('../evidence', import.meta.url));

/**
 * @param {{directory: string; writeSummary: (line: string) => void}} options
 */
export async function runScanEvidenceCli(options) {
  const result = await scanEvidenceTree(options.directory);
  options.writeSummary(
    `evidence files: ${result.filesScanned}, findings: ${result.findings}`
  );
  return result;
}

if (
  process.argv[1] !== undefined &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  try {
    await runScanEvidenceCli({
      directory: evidenceDirectory,
      writeSummary: console.log,
    });
  } catch {
    console.error('Unsafe evidence tree');
    process.exitCode = 1;
  }
}
