// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import samples from '../../src/lib/payments/oxygen/__fixtures__/webhook-samples.json';
import { openStagingInbox } from './inbox';
import { createStagingWebhookServer } from './server';

it('receives real HTTP callbacks into the durable inbox once, without accepting invalid auth', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oxygen-http-'));
  const inbox = openStagingInbox(join(dir, 'inbox.sqlite'), 'partner-example');
  const server = createStagingWebhookServer(
    {
      partnerReference: 'partner-example',
      auth: {
        mode: 'API_KEY',
        apiKey: 'example-key',
        apiSecret: 'example-secret',
      },
    },
    inbox.accept
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (secret: string) =>
    fetch(`${base}/oxygen-staging-hook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        api_key: 'example-key',
        api_secret: secret,
      },
      body: JSON.stringify(samples['Direct partner settlement callback']),
    });
  try {
    expect((await send('wrong')).status).toBe(401);
    expect(inbox.summary()).toEqual([]);
    const results = await Promise.all([
      send('example-secret'),
      send('example-secret'),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await results[0].json()).toEqual({ received: true });
    expect(inbox.summary()).toEqual([{ kind: 'settlement', count: 1 }]);
    expect((await fetch(`${base}/another-route`)).status).toBe(404);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    inbox.close();
    await rm(dir, { recursive: true, force: true });
  }
});
