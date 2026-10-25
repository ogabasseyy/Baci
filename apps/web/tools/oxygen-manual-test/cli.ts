import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { oxygenProbeResumeSchema } from '../../src/schemas/oxygen-probe';
import { CheckpointStore } from './checkpoint';
import { handleProbeRequest } from './http';
import { OxygenProbe } from './session';

async function main() {
  const args = new Set(process.argv.slice(2));
  const selected = (['production', 'dev', 'staging'] as const).filter((name) =>
    args.has(`--${name}`)
  );
  if (selected.length !== 1)
    throw new Error('Choose one environment explicitly.');
  const environment = selected[0];
  let reference = process.env.OXYGEN_TEST_REFERENCE ?? '';
  let secret = process.env.OXYGEN_TEST_SECRET ?? '';
  if (args.has('--credentials')) {
    if (!process.stdin.isTTY)
      throw new Error('Credential entry requires an interactive terminal.');
    let hidden = false;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!hidden) process.stdout.write(chunk);
        callback();
      },
    });
    const terminal = createInterface({
      input: process.stdin,
      output,
      terminal: true,
    });
    process.stdout.write('Enter partner reference (hidden): ');
    hidden = true;
    reference = (await terminal.question('')).trim();
    process.stdout.write('\nEnter partner secret (hidden): ');
    secret = (await terminal.question('')).trim();
    terminal.close();
    process.stdout.write('\n');
  }
  const port = 3417;
  const origin = `http://127.0.0.1:${port}`;
  const csrf = randomBytes(32).toString('hex');
  const configured = Boolean(reference && secret);
  const baseUrl = {
    production: 'https://api.oxygenx.africa/services/partners',
    dev: 'https://api.theoxygen.com/services/partners',
    staging: 'https://staging-api.theoxygen.com/services/partners',
  }[environment];
  const checkpoints = new CheckpointStore(
    join(homedir(), '.local', 'state', 'baci-oxygen', 'manual-test'),
    environment,
    reference
  );
  const checkpoint = configured ? await checkpoints.load() : undefined;
  if (checkpoint && process.env.OXYGEN_RESUME_SESSION)
    throw new Error('Conflicting resume sources');
  const probe = new OxygenProbe({
    baseUrl,
    environment,
    reference,
    secret,
    checkpoint,
    persistCheckpoint: (state) => checkpoints.save(state),
    resumeState: process.env.OXYGEN_RESUME_SESSION
      ? oxygenProbeResumeSchema.parse(
          JSON.parse(process.env.OXYGEN_RESUME_SESSION)
        )
      : undefined,
    resumeRejectedCreate: args.has('--resume-rejected-create'),
  });
  delete process.env.OXYGEN_RESUME_SESSION;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 16384) {
          outgoing.writeHead(413, { 'Cache-Control': 'no-store' });
          outgoing.end('{"code":"too_large"}');
          return;
        }
        chunks.push(buffer);
      }
      const request = new Request(
        `http://${incoming.headers.host}${incoming.url}`,
        {
          method: incoming.method,
          headers: Object.fromEntries(
            Object.entries(incoming.headers).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          ),
          ...(incoming.method === 'GET' || incoming.method === 'HEAD'
            ? {}
            : { body: Buffer.concat(chunks) }),
        }
      );
      const response = await handleProbeRequest(request, probe, {
        origin,
        csrf,
        environment,
        configured,
        ...probe.getUiState(),
      });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch {
      outgoing.writeHead(500, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      outgoing.end('{"code":"local_error"}');
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Oxygen ${environment.toUpperCase()} manual test: ${origin}`);
    console.log(
      configured
        ? 'Credentials configured. Every provider call requires your button click.'
        : 'Credentials missing. Restart with --credentials for private terminal entry.'
    );
  });
  server.on('error', () => {
    console.error('Unable to start local test server. Check port 3417.');
    process.exitCode = 1;
  });
}
void main().catch(() => {
  console.error('Local test startup failed.');
  process.exitCode = 1;
});
