import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loginOxygenPartner } from '../../src/lib/payments/oxygen/transport';
import { registerStagingObserver } from '../oxygen-webhook-observer/register';

async function main() {
  const callback = process.argv[2];
  const reference = process.env.OXYGEN_TEST_REFERENCE ?? '';
  const secret = process.env.OXYGEN_TEST_SECRET ?? '';
  const apiKey = process.env.OXYGEN_CALLBACK_KEY ?? '';
  const apiSecret = process.env.OXYGEN_CALLBACK_SECRET ?? '';
  const binding = process.env.OXYGEN_CALLBACK_BINDING ?? '';
  for (const key of [
    'OXYGEN_TEST_REFERENCE',
    'OXYGEN_TEST_SECRET',
    'OXYGEN_CALLBACK_KEY',
    'OXYGEN_CALLBACK_SECRET',
    'OXYGEN_CALLBACK_BINDING',
  ])
    delete process.env[key];
  if (
    binding !== createHash('sha256').update(reference).digest('hex') ||
    !apiKey ||
    !apiSecret
  )
    throw new Error('Configuration unavailable');
  // Require a healthy reachable receiver BEFORE replacing the known staging observer.
  const health = await fetch(new URL('/health', callback), {
    signal: AbortSignal.timeout(15000),
  });
  const healthBody: unknown = await health.json();
  if (
    !health.ok ||
    JSON.stringify(healthBody) !==
      JSON.stringify({ ready: true, environment: 'staging' })
  )
    throw new Error('Receiver unavailable');
  const directory = join(homedir(), '.local/state/baci-oxygen/staging-webhook');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(
    directory,
    `registration-${new Date().toISOString().replace(/[:.]/g, '-')}`
  );
  await writeFile(
    `${file}-intent.json`,
    JSON.stringify({
      environment: 'staging',
      operation: 'update',
      callback,
      attemptedAt: new Date().toISOString(),
    }),
    { mode: 0o600, flag: 'wx' }
  );
  const result = await registerStagingObserver(
    {
      operation: 'update',
      callback,
      reference,
      secret,
      callbackCredentials: { apiKey, apiSecret },
    },
    {
      fetchImpl: fetch,
      login: async (partnerReference, partnerSecret) =>
        (
          await loginOxygenPartner(
            { fetchImpl: fetch },
            {
              baseUrl: 'https://staging-api.theoxygen.com/services/partners',
              reference: partnerReference,
              secret: partnerSecret,
            }
          )
        ).token,
    }
  );
  await writeFile(`${file}-result.json`, JSON.stringify(result), {
    mode: 0o600,
    flag: 'wx',
  });
  console.log(JSON.stringify(result));
  if (result.registration !== 'confirmed') process.exitCode = 1;
}
void main().catch(() => {
  console.error(
    'Registration unconfirmed; inspect saved intent/result before another mutation.'
  );
  process.exitCode = 1;
});
