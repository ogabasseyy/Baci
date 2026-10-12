import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { routingFixture } from './private-routing.test-support.mjs';
import { generatePublicIngress } from './public-ingress.mjs';

test('real nginx TLS loopback preserves native requests, CORS and error redaction', {
  skip:
    process.platform !== 'linux' ||
    process.env.BACI_HTTPS_LOOPBACK_REHEARSAL !== '1',
  timeout: 15000,
}, async () => {
  assert.notEqual(process.geteuid(), 0);
  const directory = await mkdtemp(join(tmpdir(), 'baci-https-rehearsal-'));
  let child;
  let exited;
  const upstreamRequests = [];
  const upstream = createServer((incoming, outgoing) => {
    upstreamRequests.push(incoming.headers);
    outgoing.writeHead(401, {
      'Set-Cookie': 'synthetic=not-forwarded',
      'Access-Control-Allow-Origin': '*',
    });
    outgoing.end('synthetic-private-error-not-for-client');
  });
  try {
    upstream.listen(15440, '127.0.0.1');
    await once(upstream, 'listening');
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
      { stdio: 'ignore' }
    );
    const { receipt, inventory, now } = routingFixture();
    receipt.restRoutes = [
      {
        path: '/rest/v1/rpc/customer_savings_draft_command',
        methods: ['POST'],
      },
    ];
    const output = generatePublicIngress(receipt, inventory, now, true);
    const site = output.config
      .replace('listen 443 ssl;', 'listen 127.0.0.1:15441 ssl;')
      .replace(
        '/etc/letsencrypt/live/staging-auth.ogabassey.com/fullchain.pem',
        join(directory, 'cert.pem')
      )
      .replace(
        '/etc/letsencrypt/live/staging-auth.ogabassey.com/privkey.pem',
        join(directory, 'key.pem')
      );
    await writeFile(
      join(directory, 'nginx.conf'),
      `daemon off; master_process off; pid nginx.pid;
error_log /dev/null emerg;
events { worker_connections 32; }
http { client_body_temp_path client-body; proxy_temp_path proxy-temp; ${site} }`,
      { mode: 0o600 }
    );
    const args = ['-p', `${directory}/`, '-c', 'nginx.conf', '-e', '/dev/null'];
    execFileSync('/usr/sbin/nginx', [...args, '-t'], { stdio: 'ignore' });
    child = spawn('/usr/sbin/nginx', args, { stdio: 'ignore' });
    exited = once(child, 'exit');
    const ca = await readFile(join(directory, 'cert.pem'));
    const send = (path, method = 'GET', headers = {}) =>
      new Promise((resolve, reject) => {
        const outgoing = request(
          {
            hostname: '127.0.0.1',
            port: 15441,
            servername: 'staging-auth.ogabassey.com',
            ca,
            rejectUnauthorized: true,
            path,
            method,
            headers: { Host: 'staging-auth.ogabassey.com', ...headers },
            timeout: 2000,
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
          outgoing.destroy(new Error('Rehearsal timeout'))
        );
        outgoing.end();
      });
    let ready;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (child.exitCode !== null) throw new Error('Test nginx exited');
      try {
        ready = await send('/auth/v1/user');
        break;
      } catch {
        await pause(50);
      }
    }
    assert.equal(ready?.status, 401);
    assert.doesNotMatch(ready.body, /synthetic-private/);
    assert.equal(ready.headers['set-cookie'], undefined);
    const native = await send(
      '/rest/v1/rpc/customer_savings_draft_command',
      'POST',
      {
        Authorization: 'Bearer synthetic-only',
        Cookie: 'must-not-forward=yes',
        'X-Forwarded-Host': 'untrusted.example.invalid',
      }
    );
    assert.equal(native.status, 401);
    assert.equal(
      upstreamRequests.at(-1).authorization,
      'Bearer synthetic-only'
    );
    assert.equal(upstreamRequests.at(-1).cookie, undefined);
    assert.equal(
      upstreamRequests.at(-1)['x-forwarded-host'],
      'staging-auth.ogabassey.com'
    );
    const preflight = await send(
      '/rest/v1/rpc/customer_savings_draft_command',
      'OPTIONS',
      {
        Origin: 'https://staging.ogabassey.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,apikey,content-type',
      }
    );
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers['access-control-allow-origin'],
      'https://staging.ogabassey.com'
    );
    assert.equal((await send('/auth/v1/otp', 'OPTIONS')).status, 403);
    assert.equal(
      (
        await send('/auth/v1/user', 'GET', {
          Origin: 'https://untrusted.example.invalid',
        })
      ).status,
      403
    );
    assert.equal((await send('/auth/v1/admin/users')).status, 403);
    assert.equal((await send('/auth/v1/signup')).status, 403);
    assert.equal((await send('/unknown')).status, 404);
    await new Promise((resolve) => upstream.close(resolve));
    const unavailable = await send('/auth/v1/user');
    assert.equal(unavailable.status, 503);
    assert.doesNotMatch(
      unavailable.body,
      /nginx|127\.0\.0\.1|synthetic-private/
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
    if (upstream.listening)
      await new Promise((resolve) => upstream.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
