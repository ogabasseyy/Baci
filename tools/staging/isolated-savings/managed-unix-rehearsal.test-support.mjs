import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:https';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

export function rehearsalProcesses(children) {
  const listen = async (server, port) => {
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    return server.address().port;
  };
  const close = async (server) => {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  };
  const stop = async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
    try {
      await child.finished;
    } finally {
      clearTimeout(timer);
    }
  };
  const launch = (args) => {
    const child = spawn('/usr/bin/python3', args, {
      stdio: 'ignore',
      env: { PATH: '/usr/bin:/usr/sbin:/bin', LANG: 'C' },
    });
    child.finished = once(child, 'exit');
    children.push(child);
    return child;
  };
  const waitFor = async (check) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await check()) return;
      await pause(25);
    }
    throw new Error('Rehearsal readiness timeout');
  };
  return { listen, close, stop, launch, waitFor };
}

export function rehearsalClient(tlsPort, host, ca) {
  const send = (path, method = 'GET', headers = {}) =>
    new Promise((resolve, reject) => {
      const outgoing = request(
        {
          hostname: '127.0.0.1',
          port: tlsPort,
          servername: host,
          ca,
          rejectUnauthorized: true,
          agent: false,
          path,
          method,
          headers: { Host: host, ...headers },
          timeout: 1500,
        },
        (incoming) => {
          let body = '';
          incoming.setEncoding('utf8');
          incoming.on('data', (chunk) => {
            body += chunk;
          });
          incoming.on('end', () =>
            resolve({
              status: incoming.statusCode,
              headers: incoming.headers,
              body,
            })
          );
        }
      );
      outgoing.on('error', reject);
      outgoing.on('timeout', () =>
        outgoing.destroy(new Error('TLS request timeout'))
      );
      outgoing.end();
    });
  return send;
}

export function rehearsalCertificate(directory) {
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
      '/CN=staging-auth.ogabassey.com',
      '-addext',
      'subjectAltName=DNS:staging-auth.ogabassey.com',
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
    ],
    { stdio: 'ignore', timeout: 5000 }
  );
}
