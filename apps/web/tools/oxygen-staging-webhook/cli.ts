import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openStagingInbox } from './inbox';
import { createStagingWebhookServer } from './server';

// The launcher retrieves these from Keychain; none are written to .env or logs.
const reference = process.env.OXYGEN_TEST_REFERENCE ?? '';
const apiKey = process.env.OXYGEN_CALLBACK_KEY ?? '';
const apiSecret = process.env.OXYGEN_CALLBACK_SECRET ?? '';
const expectedBinding = process.env.OXYGEN_CALLBACK_BINDING ?? '';
for (const key of [
  'OXYGEN_TEST_REFERENCE',
  'OXYGEN_CALLBACK_KEY',
  'OXYGEN_CALLBACK_SECRET',
  'OXYGEN_CALLBACK_BINDING',
])
  delete process.env[key];
if (
  !reference ||
  !apiKey ||
  !apiSecret ||
  expectedBinding !== createHash('sha256').update(reference).digest('hex')
) {
  throw new Error('Staging callback configuration unavailable');
}
const directory = join(homedir(), '.local/state/baci-oxygen/staging-webhook');
const inbox = openStagingInbox(join(directory, 'inbox.sqlite'), reference);
if (process.argv.includes('--summary')) {
  console.log(
    JSON.stringify({ environment: 'staging', events: inbox.summary() })
  );
  inbox.close();
} else {
  const server = createStagingWebhookServer(
    {
      partnerReference: reference,
      auth: { mode: 'API_KEY', apiKey, apiSecret },
    },
    inbox.accept
  );
  server.listen(3431, '127.0.0.1', () =>
    console.log(
      'Authenticated staging callback receiver ready on 127.0.0.1:3431.'
    )
  );
  server.on('error', () => {
    console.error('Staging receiver failed');
    inbox.close();
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => {
        inbox.close();
        process.exit(0);
      });
    });
  }
}
