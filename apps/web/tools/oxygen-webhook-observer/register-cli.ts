import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { loginOxygenPartner } from '../../src/lib/payments/oxygen/transport';
import { registerStagingObserver } from './register';

let registrationSent = false;

async function main() {
  const callback = process.argv[2];
  if (!callback) throw new Error('Callback URL required.');
  let reference = process.env.OXYGEN_TEST_REFERENCE?.trim() ?? '';
  let secret = process.env.OXYGEN_TEST_SECRET?.trim() ?? '';
  delete process.env.OXYGEN_TEST_REFERENCE;
  delete process.env.OXYGEN_TEST_SECRET;
  if (!reference || !secret) {
    if (!process.stdin.isTTY)
      throw new Error('Private interactive credential entry required.');
    // Credentials never echoed, logged, or saved.
    const output = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    const terminal = createInterface({
      input: process.stdin,
      output,
      terminal: true,
    });
    try {
      process.stdout.write('Staging partner reference (hidden): ');
      reference = (await terminal.question('')).trim();
      process.stdout.write('\nStaging partner secret (hidden): ');
      secret = (await terminal.question('')).trim();
    } finally {
      terminal.close();
    }
    process.stdout.write('\n');
  }
  const result = await registerStagingObserver(
    {
      callback,
      reference,
      secret,
      operation: process.argv.includes('--update') ? 'update' : 'create',
    },
    {
      fetchImpl: (input, init) => {
        registrationSent = true;
        return fetch(input, init);
      },
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
  console.log(`Staging webhook registration HTTP ${result.status}.`);
  console.log(`Registration ${result.registration}.`);
  console.log(JSON.stringify(result.diagnostic));
  if (result.registration !== 'confirmed') {
    console.error(
      'Reconcile provider configuration before another create or update.'
    );
    process.exitCode = 1;
  }
}
void main().catch(() => {
  console.error(
    registrationSent
      ? 'Registration not confirmed. Do not retry blindly or replace an existing webhook.'
      : 'Setup or partner login failed before webhook registration was sent. Check staging credentials and callback URL.'
  );
  process.exitCode = 1;
});
