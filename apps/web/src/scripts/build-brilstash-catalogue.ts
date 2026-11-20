import { createBrilStashToolClient } from '../lib/brilstash/cli-client';
import { readBrilStashCliInput } from '../lib/brilstash/cli-input';
import { stageBrilStashSnapshot } from '../lib/brilstash/stage-catalogue';
import { brilStashBuilderInputSchema } from '../schemas/brilstash-builder-input';

async function main() {
  const { input, apply } = await readBrilStashCliInput(process.argv.slice(2));
  if (!apply) throw new Error('BrilStash staging requires --apply');
  const result = brilStashBuilderInputSchema.safeParse(input);
  if (!result.success) throw new Error('Invalid BrilStash builder input');

  const { candidateId, ...context } = result.data;
  const client = await createBrilStashToolClient();
  const staged = await stageBrilStashSnapshot(client, context, candidateId);
  process.stdout.write(`${JSON.stringify(staged)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error && /^(?:BrilStash|Invalid BrilStash|Unable to (?:read|load|confirm)|Expected an input)/.test(error.message)
    ? error.message : 'BrilStash staging failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
