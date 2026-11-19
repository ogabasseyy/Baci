import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import {
  chatwootHttpOrigin,
  platformPort,
  storefrontAuthority,
  storefrontHost,
} from './config.mjs';

export async function assertPortAvailable(host, port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, host, () => server.close(resolve));
  });
}

export function waitForHttps(url, child) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const poll = () => {
      if (child.exitCode !== null) {
        reject(new Error('Local TLS proxy exited before becoming ready'));
        return;
      }
      const request = https.get(
        url,
        { rejectUnauthorized: false },
        (response) => {
          response.resume();
          resolve();
        }
      );
      request.setTimeout(1000, () => request.destroy());
      request.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error('Timed out waiting for local TLS proxy'));
        } else {
          setTimeout(poll, 200);
        }
      });
    };
    poll();
  });
}

export async function createTlsCertificate({ certPath, keyPath }) {
  const openssl = spawn(
    process.env.OPENSSL_BIN ?? '/usr/bin/openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
    ],
    { stdio: 'ignore' }
  );
  await new Promise((resolve, reject) => {
    openssl.once('error', reject);
    openssl.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error('Could not create temporary TLS certificate'))
    );
  });
}

export async function writeCaddyfile({ caddyfilePath, certPath, keyPath }) {
  await writeFile(
    caddyfilePath,
    `{
  admin off
  auto_https disable_redirects
}

https://${storefrontAuthority}:${platformPort} {
  bind ${storefrontHost}
  tls ${certPath} ${keyPath}
  reverse_proxy ${new URL(chatwootHttpOrigin).host}
}
`
  );
}

export function startTlsProxy({ caddyfilePath, tempDir }) {
  return spawn(
    process.env.CADDY_BIN ?? '/opt/homebrew/bin/caddy',
    ['run', '--config', caddyfilePath, '--adapter', 'caddyfile'],
    {
      stdio: 'ignore',
      env: {
        ...process.env,
        XDG_CONFIG_HOME: path.join(tempDir, 'caddy-config'),
        XDG_DATA_HOME: path.join(tempDir, 'caddy-data'),
      },
    }
  );
}
