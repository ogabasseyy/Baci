import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import {
  createServer as createHttpsServer,
  request as httpsRequest,
} from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createRunnerExecutor } from './runner-transport';

it('sends a signed synthetic job through HTTPS and a separate runner process', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'runner-process-')));
  const certPath = join(dir, 'cert.pem');
  const keyPath = join(dir, 'key.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=runner.baci-test.net',
      '-addext',
      'subjectAltName=DNS:runner.baci-test.net',
      '-keyout',
      keyPath,
      '-out',
      certPath,
    ],
    { stdio: 'ignore' }
  );
  const cert = await readFile(certPath);
  const key = await readFile(keyPath);
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('./runner-process.fixture.ts', import.meta.url)),
    ],
    {
      env: { ...process.env, BACI_TEST_SOCKET: join(dir, 'runner.sock') },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let tls: ReturnType<typeof createHttpsServer> | undefined;
  try {
    const [chunk] = await Promise.race([
      once(child.stdout, 'data'),
      once(child, 'exit').then(() => {
        throw Error('FIXTURE_EXITED');
      }),
    ]);
    const loopback = new URL(String(chunk).trim());
    tls = createHttpsServer({ key, cert }, (req, res) => {
      const upstream = httpRequest(
        {
          hostname: '127.0.0.1',
          port: Number(loopback.port),
          method: req.method,
          path: req.url,
          headers: req.headers,
        },
        (reply) => {
          res.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(res);
        }
      );
      upstream.on('error', () => res.writeHead(502).end());
      req.pipe(upstream);
    });
    await new Promise<void>((resolve) => tls?.listen(0, '127.0.0.1', resolve));
    const address = tls.address();
    if (!address || typeof address === 'string') throw Error('NO_TLS_PORT');
    const port = address.port;
    const transport: typeof fetch = async (_url, init) =>
      new Promise((resolve, reject) => {
        const request = httpsRequest(
          {
            hostname: '127.0.0.1',
            port,
            servername: 'runner.baci-test.net',
            ca: cert,
            method: 'POST',
            path: '/v1/execute',
            headers: Object.fromEntries(new Headers(init?.headers)),
          },
          (reply) => {
            const chunks: Buffer[] = [];
            reply.on('data', (part: Buffer) => chunks.push(part));
            reply.on('end', () =>
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: reply.statusCode,
                  headers: {
                    'x-baci-runner-signature': String(
                      reply.headers['x-baci-runner-signature'] ?? ''
                    ),
                  },
                })
              )
            );
          }
        );
        request.on('error', reject);
        request.end(init?.body);
      });
    const execute = createRunnerExecutor({
      endpoint: `https://runner.baci-test.net:${port}/v1/execute`,
      key: Buffer.alloc(32, 7),
      toolchainDigest: 'a'.repeat(64),
      fetch: transport,
    });
    await expect(
      execute('compile', { synthetic: true })
    ).resolves.toMatchObject({
      output: { payload: { synthetic: true } },
      jobId: 'synthetic',
    });
  } finally {
    if (tls) {
      tls.closeAllConnections();
      await new Promise<void>((resolve) => tls?.close(() => resolve()));
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit').catch(() => undefined);
    }
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
