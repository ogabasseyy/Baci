import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildReplayArtifact } from '../replay-artifact';
import { replayArtifactInputSchema } from '../schemas/replay-artifact';

const flags = {
  '--receiver-root': 'receiverRoot',
  '--savings-root': 'savingsRoot',
  '--output-directory': 'outputDirectory',
} as const;

export async function runReplayArtifactCli(
  argumentsList: readonly string[] = process.argv.slice(2),
  build: typeof buildReplayArtifact = buildReplayArtifact
) {
  const input: Record<string, string> = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!Object.hasOwn(flags, flag) || !value || value.startsWith('--')) {
      throw new Error('Replay artifact arguments refused');
    }
    const field = flags[flag as keyof typeof flags];
    if (Object.hasOwn(input, field)) {
      throw new Error('Duplicate replay artifact argument refused');
    }
    input[field] = value;
  }
  return await build(replayArtifactInputSchema.parse(input));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void runReplayArtifactCli()
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error('Replay artifact preparation refused');
      process.exitCode = 1;
    });
}
