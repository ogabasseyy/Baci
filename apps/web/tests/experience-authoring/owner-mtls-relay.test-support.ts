import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOwnerMtlsFetch } from '@/lib/experience/owner-mtls-fetch';

/** Synthetic loopback TLS relay that mimics the dedicated owner ingress. */
export async function startSyntheticOwnerMtlsRelay(ownerPort: number) {
  const dir = mkdtempSync(join(tmpdir(), 'baci-mtls-relay-'));
  const file = (name: string) => join(dir, name);
  const openssl = (...args: string[]) =>
    execFileSync('openssl', args, { stdio: 'ignore' });
  let server: ReturnType<typeof createServer> | undefined;
  try {
    openssl(
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=Synthetic CA',
      '-keyout',
      file('ca.key'),
      '-out',
      file('ca.pem')
    );
    for (const name of ['server', 'client']) {
      openssl(
        'req',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-subj',
        `/CN=${name === 'server' ? 'localhost' : 'Synthetic Client'}`,
        '-keyout',
        file(`${name}.key`),
        '-out',
        file(`${name}.csr`)
      );
      openssl(
        'x509',
        '-req',
        '-days',
        '1',
        '-in',
        file(`${name}.csr`),
        '-CA',
        file('ca.pem'),
        '-CAkey',
        file('ca.key'),
        '-CAcreateserial',
        '-out',
        file(`${name}.pem`)
      );
    }
    server = createServer(
      {
        key: readFileSync(file('server.key')),
        cert: readFileSync(file('server.pem')),
        ca: readFileSync(file('ca.pem')),
        requestCert: true,
        rejectUnauthorized: true,
      },
      (incoming, outgoing) => {
        const upstream = request(
          {
            host: '127.0.0.1',
            port: ownerPort,
            path: incoming.url,
            method: incoming.method,
            headers: {
              ...incoming.headers,
              host: 'owner.baci-internal.invalid',
            },
          },
          (response) => {
            outgoing.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(outgoing);
          }
        );
        upstream.on('error', () => outgoing.destroy());
        incoming.pipe(upstream);
      }
    );
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject);
      server?.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('NO_TLS_LISTENER');
    const fetch = createOwnerMtlsFetch({
      origin: `https://localhost:${address.port}`,
      cert: readFileSync(file('client.pem'), 'utf8'),
      key: readFileSync(file('client.key'), 'utf8'),
      ca: readFileSync(file('ca.pem'), 'utf8'),
    });
    return {
      fetch,
      async close() {
        server?.closeAllConnections();
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    server?.closeAllConnections();
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
