/** Disposable process smoke test. No production credentials, database or network. */
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair } from 'jose';
import { startProductionBuilderStack } from '../../src/lib/experience/production-builder-stack';
import { createTransientOutputStore } from '../experience-runner/transient-output-store';

async function main() {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (!address || typeof address === 'string') throw Error('FIXTURE_PORT');
  const port = address.port;
  const second = createServer();
  second.listen(0, '127.0.0.1');
  await once(second, 'listening');
  const secondAddress = second.address();
  if (!secondAddress || typeof secondAddress === 'string')
    throw Error('FIXTURE_PORT');
  const deliveryPort = secondAddress.port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve()))
  );
  await new Promise<void>((resolve, reject) =>
    second.close((error) => (error ? reject(error) : resolve()))
  );
  const dir = mkdtempSync(join(tmpdir(), 'baci-process-fixture-'));
  const key = await generateKeyPair('ES256');
  const pub = {
    ...(await exportJWK(key.publicKey)),
    kid: 'synthetic',
    alg: 'ES256',
  };
  const unavailable = () => Promise.reject(Error('SYNTHETIC_UNAVAILABLE'));
  let closed = false;
  try {
    const stack = await startProductionBuilderStack({
      port,
      deliveryPort,
      host: {
        startBroker: async () => ({
          runtime: {
            readConnection: unavailable,
            resolveLinkedAccessToken: unavailable,
          },
          publicBinding: {
            supabase: {
              url: 'https://synthetic.supabase.co',
              anonKey: 'synthetic-public',
            },
            jwks: { keys: [pub] },
          },
          close: () => {
            closed = true;
            return Promise.resolve();
          },
        }),
        integration: {
          hostOrigin: 'https://builder.baci.test',
          executionOrigin: 'https://output.runtime.test',
          artifactDirectory: dir,
          canonicalBase: (slug) => `https://${slug}.merchant.test/${slug}`,
          publicClient: { rpc: unavailable } as never,
          approval: {
            load: unavailable,
            confirm: unavailable,
            loadLifecycle: unavailable,
            confirmPublication: unavailable,
            confirmModeExit: unavailable,
          },
          runner: {
            endpoint: 'https://runner.runtime.test/v1/execute',
            key: new Uint8Array(32).fill(1),
            toolchainDigest: 'a'.repeat(64),
          },
          build: {
            key: new Uint8Array(32).fill(2),
            toolchainDigest: 'a'.repeat(64),
            transient: createTransientOutputStore(),
            recordVerifiedEvidence: unavailable,
          },
          recordCapture: unavailable,
        },
      },
    });
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/.well-known/oauth-protected-resource/builder/mcp`
      );
      if (response.status !== 200) throw Error('DISCOVERY_FAILED');
      const output = await new Promise<{ status: number; csp: boolean }>(
        (resolve, reject) => {
          const req = request(
            {
              host: '127.0.0.1',
              port: deliveryPort,
              path: `/resource/${'a'.repeat(64)}/index.html`,
              headers: { host: 'output.runtime.test' },
            },
            (res) => {
              res.resume();
              res.on('end', () =>
                resolve({
                  status: res.statusCode ?? 0,
                  csp: Boolean(res.headers['content-security-policy']),
                })
              );
            }
          );
          req.on('error', reject);
          req.end();
        }
      );
      if (output.status !== 404 || !output.csp) throw Error('OUTPUT_FAILED');
    } finally {
      await stack.close();
    }
    if (!closed) throw Error('BROKER_NOT_CLOSED');
    process.stdout.write('STACK_LIFECYCLE_OK\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
void main();
