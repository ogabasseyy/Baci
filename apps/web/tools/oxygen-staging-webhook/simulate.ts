import { randomBytes } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import samples from '../../src/lib/payments/oxygen/__fixtures__/webhook-samples.json';
import { parseOxygenWebhook } from '../../src/lib/payments/oxygen/webhook';
import { openStagingInbox } from './inbox';
import { createStagingWebhookServer } from './server';

/** Runs only against an ephemeral loopback server and a NEW simulation directory. */
export async function simulateStagingCallbacks(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await readdir(directory)).length !== 0) {
    throw new Error(
      'Simulation requires an empty directory; existing inbox preserved'
    );
  }
  await writeFile(
    join(directory, '.simulation-only'),
    'Documented synthetic fixtures only\n',
    { flag: 'wx', mode: 0o600 }
  );
  const database = join(directory, 'inbox.sqlite');
  const inbox = openStagingInbox(database, 'partner-example');
  const apiKey = randomBytes(32).toString('hex');
  const apiSecret = randomBytes(32).toString('hex');
  const server = createStagingWebhookServer(
    {
      partnerReference: 'partner-example',
      auth: { mode: 'API_KEY', apiKey, apiSecret },
    },
    inbox.accept
  );
  const checks: { name: string; status: number; expected: number }[] = [];
  async function check(name: string, result: Response, expected: number) {
    checks.push({ name, status: result.status, expected });
    const body: unknown = await result.json();
    if (
      result.status !== expected ||
      (expected === 200 &&
        (!body ||
          typeof body !== 'object' ||
          !('received' in body) ||
          body.received !== true))
    ) {
      throw new Error(`Simulation check failed: ${name}`);
    }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send = (body: unknown, secret = apiSecret) =>
      fetch(`${base}/oxygen-staging-hook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          api_key: apiKey,
          api_secret: secret,
        },
        body: JSON.stringify(body),
      });
    await check(
      'Unauthenticated callback',
      await send(samples['Transaction callback'], 'incorrect'),
      401
    );
    await check(
      'Invalid callback shape',
      await send({ webhook_type: 'unknown' }),
      400
    );
    for (const [name, sample] of Object.entries(samples)) {
      await check(name, await send(sample), 200);
    }
    for (const name of [
      'Transaction callback',
      'Vendor settlement callback',
      'Direct partner settlement callback',
    ] as const) {
      await check(`Duplicate ${name}`, await send(samples[name]), 200);
    }
    await check(
      'Conflicting settlement replay',
      await send({
        ...samples['Direct partner settlement callback'],
        amount: 1,
      }),
      503
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    inbox.close();
  }
  const reopened = openStagingInbox(database, 'partner-example');
  let afterRestart: { kind: string; count: number }[];
  try {
    afterRestart = reopened.summary();
  } finally {
    reopened.close();
  }
  const expectedSummary = [
    { kind: 'address', count: 1 },
    { kind: 'settlement', count: 2 },
    { kind: 'transaction', count: 1 },
  ];
  if (JSON.stringify(afterRestart) !== JSON.stringify(expectedSummary))
    throw new Error('Simulation persistence mismatch');
  const result = {
    simulationOnly: true,
    completedAt: new Date().toISOString(),
    transport: 'ephemeral_loopback_http',
    providerCalls: 0,
    realOrderChanges: 0,
    authenticatedSamples: checks.filter(
      (c) => Object.keys(samples).includes(c.name) && c.status === 200
    ).length,
    duplicateAcknowledgements: checks.filter(
      (c) => c.name.startsWith('Duplicate ') && c.status === 200
    ).length,
    unauthenticatedStatus: checks.find(
      (c) => c.name === 'Unauthenticated callback'
    )?.status,
    invalidPayloadStatus: checks.find(
      (c) => c.name === 'Invalid callback shape'
    )?.status,
    conflictingReplayStatus: checks.find(
      (c) => c.name === 'Conflicting settlement replay'
    )?.status,
    afterRestart,
    checks,
    expectedCheckoutWork: [
      ...new Set(
        Object.values(samples).map(
          (sample) => parseOxygenWebhook(sample)?.action
        )
      ),
    ],
    // This report cannot provide live financial evidence or authorise mutations.
    bankReceiptConfirmed: false,
    activationAuthorized: false,
  };
  await writeFile(
    join(directory, 'simulation-report.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' }
  );
  return result;
}
