import { createBrilStashToolClient } from '../lib/brilstash/cli-client';
import { readBrilStashCliInput } from '../lib/brilstash/cli-input';
import { resolveBrilStashOperatorCommand, runBrilStashOperatorCommand } from '../lib/brilstash/operator-command';

async function main() {
  const { input, apply } = await readBrilStashCliInput(process.argv.slice(2));
  resolveBrilStashOperatorCommand(input, apply);
  const client = await createBrilStashToolClient();
  const result = await runBrilStashOperatorCommand(client, input, apply);
  process.stdout.write(`${JSON.stringify(result ?? { ok: true })}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error && /^(?:BrilStash|Invalid BrilStash|Unable to read BrilStash|Expected an input)/.test(error.message)
    ? error.message : 'BrilStash operator command failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
