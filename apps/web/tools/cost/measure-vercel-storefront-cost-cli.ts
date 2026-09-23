import { assertMeasurementOutputPath } from './assert-measurement-output-path';
import { measureVercelStorefrontCost } from './measure-vercel-storefront-cost';
import { parseMeasurementArgs } from './parse-measurement-args';
import { writeMeasurementReport } from './write-measurement-report';

/** CLI entry for measuring Vercel storefront cost from FOCUS billing exports. */
export async function runMeasurementCli(
  args: readonly string[] = process.argv.slice(2)
): Promise<void> {
  const parsed = parseMeasurementArgs(args);
  const result = await measureVercelStorefrontCost(parsed);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (parsed.outputPath) {
    const inputPaths = [
      parsed.before.inputPath,
      parsed.after?.inputPath,
      parsed.before.window.cacheProbePath,
      parsed.before.window.dbTracePath,
      parsed.after?.window.cacheProbePath,
      parsed.after?.window.dbTracePath,
    ].filter((path): path is string => typeof path === 'string');
    await assertMeasurementOutputPath(parsed.outputPath, inputPaths);
    await writeMeasurementReport(parsed.outputPath, serialized);
  } else {
    process.stdout.write(serialized);
  }
}

if (process.argv[1]?.endsWith('measure-vercel-storefront-cost-cli.ts')) {
  void runMeasurementCli().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'measurement failed';
    console.error(message);
    process.exitCode = 1;
  });
}
