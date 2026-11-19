import { readFile, stat } from 'node:fs/promises';

export async function readBrilStashCliInput(args: string[]) {
  const [inputFile, applyFlag] = args;
  if (
    !inputFile ||
    inputFile.startsWith('-') ||
    args.length > 2 ||
    (applyFlag !== undefined && applyFlag !== '--apply')
  ) {
    throw new Error('Expected an input JSON file followed by optional --apply');
  }

  let input: unknown;
  try {
    const info = await stat(inputFile);
    if (!info.isFile() || info.size > 262144)
      throw new Error('Invalid input size');
    input = JSON.parse(await readFile(inputFile, 'utf8'));
  } catch {
    throw new Error('Unable to read BrilStash input file');
  }
  return { input, apply: applyFlag === '--apply' };
}
