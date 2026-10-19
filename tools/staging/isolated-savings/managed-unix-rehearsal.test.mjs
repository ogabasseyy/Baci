import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { secureManagedSocket } from './managed-files.mjs';
import {
  generateManagedGateway,
  startManagedGateway,
} from './managed-gateway.mjs';
import { generateManagedPublicIngress } from './managed-public-ingress.mjs';
import {
  rehearsalCertificate,
  rehearsalClient,
  rehearsalProcesses,
} from './managed-unix-rehearsal.test-support.mjs';
import { routingFixture } from './private-routing.test-support.mjs';

test('real Linux nginx: managed Unix TLS, inventory withdrawal, TCP decoy isolation', {
  skip:
    process.platform !== 'linux' ||
    process.env.BACI_MANAGED_UNIX_REHEARSAL !== '1',
  timeout: 20000,
}, async (context) => {
  assert.notEqual(process.geteuid(), 0);
  const directory = await mkdtemp('/tmp/baci-unix-rehearsal-');
  const socket = join(directory, 'runtime', 'ingress.sock');
  const requests = [];
  let decoyRequests = 0;
  let releasePoll;
  let supervision;
  const children = [];
  const controller = new AbortController();
  const backend = createServer((incoming, outgoing) => {
    requests.push({
      headers: incoming.headers,
      method: incoming.method,
      url: incoming.url,
    });
    outgoing.writeHead(401, {
      'Set-Cookie': 'synthetic=discard',
      'Access-Control-Allow-Origin': '*',
    });
    outgoing.end('synthetic-private-error');
  });
  const decoy = createServer((_incoming, outgoing) => {
    decoyRequests += 1;
    outgoing.end('tcp-decoy-must-never-be-public');
  });
  const reserve = createServer();
  const { listen, close, stop, launch, waitFor } = rehearsalProcesses(children);
  try {
    await listen(decoy, 15440);
    const backendPort = await listen(backend, 0);
    const tlsPort = await listen(reserve, 0);
    await close(reserve);
    await mkdir(join(directory, 'runtime'), { mode: 0o750 });
    await chmod(join(directory, 'runtime'), 0o750);
    for (const name of ['private', 'public'])
      await mkdir(join(directory, name), { mode: 0o700 });
    rehearsalCertificate(directory);
    const input = routingFixture();
    const start = Date.now();
    input.now = start;
    input.receipt.verifiedAt = new Date(start).toISOString();
    input.inventory.observedAt = input.receipt.verifiedAt;
    input.receipt.restRoutes = [
      {
        path: '/rest/v1/rpc/customer_savings_draft_command',
        methods: ['POST'],
      },
    ];
    const { host, containers, networks, restRoutes } = input.receipt;
    const binding = {
      version: 1,
      identity: { host, containers, networks, restRoutes },
      reviewedAt: input.receipt.verifiedAt,
      leaseNotBefore: input.receipt.verifiedAt,
      leaseExpiresAt: new Date(start + 60000).toISOString(),
    };
    const originalEvidence = structuredClone(input);
    const privateOutput = generateManagedGateway(
      binding,
      input.inventory,
      start
    );
    const publicOutput = generateManagedPublicIngress(
      binding,
      input,
      start,
      true
    );
    const fixturePrivate = (config) =>
      config
        .replaceAll('/run/baci-savings-gateway/ingress.sock', socket)
        .replace(
          `server ${containers.auth.ip}:9999;`,
          `server 127.0.0.1:${backendPort};`
        )
        .replace(
          `server ${containers.rest.ip}:3000;`,
          `server 127.0.0.1:${backendPort};`
        );
    assert.equal(
      (
        fixturePrivate(privateOutput.config).match(
          new RegExp(`127\\.0\\.0\\.1:${backendPort}`, 'g')
        ) || []
      ).length,
      2
    );
    const publicSite = publicOutput.config
      .replace('listen 443 ssl;', `listen 127.0.0.1:${tlsPort} ssl;`)
      .replaceAll('/run/baci-savings-gateway/ingress.sock', socket)
      .replace(
        '/etc/letsencrypt/live/staging-auth.ogabassey.com/fullchain.pem',
        join(directory, 'cert.pem')
      )
      .replace(
        '/etc/letsencrypt/live/staging-auth.ogabassey.com/privkey.pem',
        join(directory, 'key.pem')
      );
    assert.doesNotMatch(publicSite, /15440|proxy_pass http:\/\/127/);
    await writeFile(
      join(directory, 'public/nginx.conf'),
      `daemon off; master_process off; pid nginx.pid;
error_log /dev/null emerg; events { worker_connections 32; }
http { client_body_temp_path client-body; proxy_temp_path proxy-temp; ${publicSite} }`,
      { mode: 0o600 }
    );
    const launcher = fileURLToPath(
      new URL('./private-routing-supervisor-child.py', import.meta.url)
    );
    const args = (name, mode) => [
      launcher,
      String(process.pid),
      join(directory, name),
      mode,
    ];
    const parse = (name) =>
      execFileSync('/usr/bin/python3', args(name, '--test'), {
        stdio: 'ignore',
        timeout: 3000,
      });
    let privateChild;
    let unhealthy = false;
    supervision = startManagedGateway(
      binding,
      input,
      {
        now: Date.now,
        monotonicNow: () => performance.now(),
        binding: () => structuredClone(binding),
        inventory: () => {
          const inventory = structuredClone(input.inventory);
          inventory.observedAt = new Date().toISOString();
          if (unhealthy)
            inventory.containers[0].State.Health.Status = 'unhealthy';
          return inventory;
        },
        prepare: async (config) => {
          await writeFile(
            join(directory, 'private/nginx.conf'),
            fixturePrivate(config),
            { mode: 0o600 }
          );
          parse('private');
          await assert.rejects(lstat(socket), { code: 'ENOENT' });
        },
        start: async () => {
          privateChild = launch(args('private', '--serve'));
          await waitFor(async () => {
            try {
              return ((await lstat(socket)).mode & 0o777) === 0o666;
            } catch (error) {
              if (error.code === 'ENOENT') return false;
              throw error;
            }
          });
          await secureManagedSocket(
            socket,
            await lstat(socket),
            process.geteuid(),
            process.getegid()
          );
          return {
            alive: () =>
              privateChild.exitCode === null &&
              privateChild.signalCode === null,
            exited: privateChild.finished,
          };
        },
        pause: () =>
          new Promise((resolve) => {
            releasePoll = resolve;
          }),
        stop: () => stop(privateChild),
        cleanup: async () => {
          if (privateChild) await stop(privateChild);
        },
      },
      controller.signal
    ).then(
      () => null,
      (error) => error
    );
    await waitFor(() => Boolean(releasePoll));
    assert.equal((await lstat(socket)).mode & 0o777, 0o660);
    parse('public');
    launch(args('public', '--serve'));
    const ca = await readFile(join(directory, 'cert.pem'));
    const send = rehearsalClient(tlsPort, host, ca);
    await waitFor(async () => {
      try {
        return (await send('/auth/v1/user')).status === 401;
      } catch (error) {
        if (error.code === 'ECONNREFUSED') return false;
        throw error;
      }
    });
    const native = await send(restRoutes[0].path, 'POST', {
      Authorization: 'Bearer synthetic-only',
      Cookie: 'discard=yes',
    });
    assert.equal(native.status, 401);
    assert.doesNotMatch(native.body, /synthetic-private/);
    assert.equal(native.headers['set-cookie'], undefined);
    assert.equal(
      requests.at(-1).headers.authorization,
      'Bearer synthetic-only'
    );
    assert.equal(requests.at(-1).headers.cookie, undefined);
    assert.equal(requests.at(-1).method, 'POST');
    assert.equal(requests.at(-1).url, '/rpc/customer_savings_draft_command');
    const preflight = await send(restRoutes[0].path, 'OPTIONS', {
      Origin: 'https://staging.ogabassey.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,apikey,content-type',
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers['access-control-allow-origin'],
      'https://staging.ogabassey.com'
    );
    assert.equal((await send(restRoutes[0].path, 'OPTIONS')).status, 403);
    assert.equal(
      (await send('/auth/v1/user', 'GET', { Origin: 'null' })).status,
      403
    );
    assert.equal((await send('/auth/v1/admin/users')).status, 403);
    assert.equal((await send('/auth/v1/signup', 'POST')).status, 403);
    assert.equal((await send('/unknown')).status, 404);
    const beforeWithdrawal = requests.length;
    unhealthy = true;
    releasePoll();
    assert.ok((await supervision) instanceof Error);
    await assert.rejects(lstat(socket), { code: 'ENOENT' });
    const unavailable = await send('/auth/v1/user');
    assert.equal(unavailable.status, 503);
    assert.doesNotMatch(
      unavailable.body,
      /nginx|127\.0\.0\.1|\/tmp\/|synthetic|decoy/
    );
    assert.equal(requests.length, beforeWithdrawal);
    assert.equal(decoyRequests, 0);
    assert.equal(decoy.listening, true);
    assert.deepEqual(input, originalEvidence);
    context.diagnostic(
      'Both nginx parsers passed; Unix 0660/native POST/CORS/redaction passed; unhealthy inventory removed socket; TLS 503 with live TCP15440 decoy and zero decoy hits.'
    );
  } finally {
    controller.abort();
    releasePoll?.();
    for (const child of children.reverse()) await stop(child);
    if (supervision) await supervision;
    await close(backend);
    await close(decoy);
    await close(reserve);
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(lstat(directory), { code: 'ENOENT' });
    context.diagnostic(
      'Owned child processes exited; disposable certificates, configs and socket directory removed.'
    );
  }
});
