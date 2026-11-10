import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { ServerOptions } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Ephemeral synthetic leaf only. No global trust-store change or private Baci key. */
export function createPerformanceTls(origins: readonly string[]) {
  const hosts = origins.map((origin) => new URL(origin).hostname);
  if (
    hosts.length !== 2 ||
    new Set(hosts).size !== 2 ||
    hosts.some(
      (host) =>
        host.length > 253 ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
          host
        )
    )
  )
    throw Error('INVALID_TLS_HARNESS_HOST');
  const directory = mkdtempSync(join(tmpdir(), 'baci-cwv-tls-'));
  const close = () => rmSync(directory, { recursive: true, force: true });
  try {
    const keyPath = join(directory, 'key.pem');
    const certPath = join(directory, 'cert.pem');
    const configPath = join(directory, 'openssl.cnf');
    writeFileSync(
      configPath,
      `[req]\ndistinguished_name=dn\nx509_extensions=extensions\n[dn]\n[extensions]\nsubjectAltName=${hosts.map((host) => `DNS:${host}`).join(',')}\n`,
      { mode: 0o600 }
    );
    execFileSync(
      '/usr/bin/openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-sha256',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-subj',
        '/CN=Baci synthetic CWV',
        '-config',
        configPath,
      ],
      {
        stdio: 'ignore',
        timeout: 10000,
        env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
      }
    );
    chmodSync(keyPath, 0o600);
    const cert = readFileSync(certPath);
    const parsed = new X509Certificate(cert);
    if (hosts.some((host) => !parsed.checkHost(host)))
      throw Error('INVALID_TLS_HARNESS_CERTIFICATE');
    const spki = createHash('sha256')
      .update(parsed.publicKey.export({ format: 'der', type: 'spki' }))
      .digest('base64');
    const options: ServerOptions = {
      key: readFileSync(keyPath),
      cert,
      minVersion: 'TLSv1.2',
    };
    return { options, spki, close };
  } catch (error) {
    close();
    throw error;
  }
}
