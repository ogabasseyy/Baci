// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOwnerMtlsFetch } from './owner-mtls-fetch';

it('uses a verified client certificate for fixed owner routes and rejects other destinations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baci-owner-mtls-'));
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
    openssl(
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=Untrusted',
      '-keyout',
      file('rogue.key'),
      '-out',
      file('rogue.pem')
    );
    let accepted = 0;
    let mode: 'normal' | 'redirect' | 'oversized' | 'pending' = 'normal';
    server = createServer(
      {
        key: readFileSync(file('server.key')),
        cert: readFileSync(file('server.pem')),
        ca: readFileSync(file('ca.pem')),
        requestCert: true,
        rejectUnauthorized: true,
      },
      (req, res) => {
        accepted++;
        expect(req.url).toBe('/internal/owner/preview');
        expect(req.headers['x-baci-owner-signature']).toBe('a'.repeat(64));
        req.resume();
        req.on('end', () => {
          if (mode === 'redirect') {
            res.writeHead(302, { location: 'https://evil.invalid/' });
            res.end();
            return;
          }
          if (mode === 'oversized') {
            res.writeHead(200);
            res.end('x'.repeat(262145));
            return;
          }
          if (mode === 'pending') return;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"ok":true}');
        });
      }
    );
    await new Promise<void>((resolve) =>
      server?.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const fetch = createOwnerMtlsFetch({
      origin: `https://localhost:${address.port}`,
      cert: readFileSync(file('client.pem'), 'utf8'),
      key: readFileSync(file('client.key'), 'utf8'),
      ca: readFileSync(file('ca.pem'), 'utf8'),
    });
    const response = await fetch(
      'https://owner.baci-internal.invalid/internal/owner/preview',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-baci-owner-signature': 'a'.repeat(64),
        },
        body: '{}',
      }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const init = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-baci-owner-signature': 'a'.repeat(64),
      },
      body: '{}',
    };
    const untrustedClient = createOwnerMtlsFetch({
      origin: `https://localhost:${address.port}`,
      cert: readFileSync(file('rogue.pem'), 'utf8'),
      key: readFileSync(file('rogue.key'), 'utf8'),
      ca: readFileSync(file('ca.pem'), 'utf8'),
    });
    await expect(
      untrustedClient(
        'https://owner.baci-internal.invalid/internal/owner/preview',
        init
      )
    ).rejects.toThrow();
    const untrustedServer = createOwnerMtlsFetch({
      origin: `https://localhost:${address.port}`,
      cert: readFileSync(file('client.pem'), 'utf8'),
      key: readFileSync(file('client.key'), 'utf8'),
      ca: readFileSync(file('rogue.pem'), 'utf8'),
    });
    await expect(
      untrustedServer(
        'https://owner.baci-internal.invalid/internal/owner/preview',
        init
      )
    ).rejects.toThrow();
    expect(accepted).toBe(1);
    mode = 'redirect';
    await expect(
      fetch('https://owner.baci-internal.invalid/internal/owner/preview', init)
    ).rejects.toThrow('OWNER_MTLS_REDIRECT');
    mode = 'oversized';
    await expect(
      fetch('https://owner.baci-internal.invalid/internal/owner/preview', init)
    ).rejects.toThrow('OWNER_MTLS_RESPONSE_TOO_LARGE');
    mode = 'pending';
    await expect(
      fetch('https://owner.baci-internal.invalid/internal/owner/preview', {
        ...init,
        signal: AbortSignal.timeout(100),
      })
    ).rejects.toThrow();
    await expect(
      fetch('https://evil.invalid/internal/owner/preview', {
        method: 'POST',
        body: '{}',
      })
    ).rejects.toThrow();
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
