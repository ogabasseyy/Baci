import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Replaces a report atomically with a newly-created private file. */
export async function writeMeasurementReport(
  outputPath: string,
  serialized: string
): Promise<void> {
  const temporaryDirectory = await mkdtemp(
    join(dirname(outputPath), '.vercel-cost-report-')
  );
  const temporaryPath = join(temporaryDirectory, 'report.json');
  try {
    await writeFile(temporaryPath, serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
