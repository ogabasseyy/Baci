// Separate staging-only observation server. Never updates customer/loan state.
import { appendFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDeliveryBudget } from './delivery-budget';
import { observeWebhook } from './observer';

const port = 3430;
// Correlation marker only, not authentication. All observations stay unverified.
const marker = 'baci-staging-observer';
const directory = join(homedir(), '.local/state/baci-oxygen/webhook-observer');
const output = join(directory, 'observations.jsonl');
await mkdir(directory, { recursive: true, mode: 0o700 });
const budget = createDeliveryBudget(100);
const server = createServer(async (incoming, outgoing) => {
  outgoing.setHeader('Cache-Control', 'no-store');
  const finish = budget.reserve();
  if (!finish) {
    outgoing.writeHead(429);
    outgoing.end();
    return;
  }
  try {
    // Bound the stream before constructing the Web Request as well.
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of incoming) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 262144) {
        outgoing.writeHead(413);
        outgoing.end();
        return;
      }
      chunks.push(buffer);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === 'string') headers.set(name, value);
    }
    const method = incoming.method ?? 'GET';
    const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, {
      method,
      headers,
      ...(method === 'GET' || method === 'HEAD'
        ? {}
        : { body: Buffer.concat(chunks) }),
    });
    const result = await observeWebhook(request, {
      path: '/oxygen-staging-hook',
      marker,
    });
    if (result.observation) {
      await appendFile(
        output,
        `${JSON.stringify({ receivedAt: new Date().toISOString(), ...result.observation })}\n`,
        { mode: 0o600 }
      );
      finish(true);
      console.log(
        `Delivery observed (${budget.recorded()}); authentication unverified; application state unchanged.`
      );
    }
    outgoing.writeHead(result.status);
    outgoing.end();
  } catch {
    outgoing.writeHead(500);
    outgoing.end();
  } finally {
    finish(false);
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Staging observation receiver listening on port ${port}.`)
);
server.on('error', () => {
  console.error('Receiver startup failed.');
  process.exitCode = 1;
});
