import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

async function resolvedPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

/** Rejects --out paths that would destroy measurement evidence inputs. */
export async function assertMeasurementOutputPath(
  outputPath: string,
  inputPaths: readonly string[]
): Promise<void> {
  const resolvedOutput = await resolvedPath(outputPath);
  for (const inputPath of inputPaths) {
    if ((await resolvedPath(inputPath)) === resolvedOutput) {
      throw new Error('measurement --out must not overwrite an input path');
    }
  }
}
