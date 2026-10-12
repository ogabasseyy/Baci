import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';

// Generation-directory confinement for the lab web loader (mirror of the
// generator's loadGeneration guard; TS cannot import infra): a symlinked
// generations/<id> entry must never serve a manifest or tier reads from
// outside the configured output tree. Throws a coded error so callers map
// missing entries and escapes to their own statuses.
export class LabGenerationConfinementError extends Error {
  code: 'generation-escape' | 'generation-missing';

  constructor(
    code: 'generation-escape' | 'generation-missing',
    message: string
  ) {
    super(message);
    this.code = code;
    this.name = 'LabGenerationConfinementError';
  }
}

const GENERATION_ID_PATTERN = /^[0-9a-f]{64}$/;

export async function resolveLabGenerationDir(
  outputRoot: string,
  generationId: string
): Promise<string> {
  const dir = join(outputRoot, 'generations', generationId);
  if (!GENERATION_ID_PATTERN.test(generationId)) {
    throw new LabGenerationConfinementError(
      'generation-missing',
      'generation is not published'
    );
  }
  const stat = await lstat(dir).catch(() => null);
  if (!stat) {
    throw new LabGenerationConfinementError(
      'generation-missing',
      'generation is not published'
    );
  }
  if (!stat.isDirectory()) {
    throw new LabGenerationConfinementError(
      'generation-escape',
      'generation entry is not a directory'
    );
  }
  const generationsRoot = join(outputRoot, 'generations');
  // Bind the root itself before trusting its children: a symlinked
  // generations/ would otherwise resolve outside the output tree and
  // let loads accept external generations as reusable.
  const realOutput = await realpath(outputRoot).catch(() => null);
  if (!realOutput) {
    throw new LabGenerationConfinementError(
      'generation-missing',
      'generation is not published'
    );
  }
  const realRoot = await realpath(generationsRoot).catch(() => null);
  if (!realRoot) {
    throw new LabGenerationConfinementError(
      'generation-missing',
      'generation is not published'
    );
  }
  if (realRoot !== join(realOutput, 'generations')) {
    throw new LabGenerationConfinementError(
      'generation-escape',
      'generations root escapes the output root'
    );
  }
  if (
    (await realpath(dir).catch(() => null)) !== join(realRoot, generationId)
  ) {
    throw new LabGenerationConfinementError(
      'generation-escape',
      'generation entry escapes the output root'
    );
  }
  return dir;
}
