/** Actual isolated Supabase Auth; synthetic users/client, no deployed project access. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { waitForDatabase } from './database-readiness.mjs';

export async function startUpstreamFixture() {
  const suffix = randomUUID().slice(0, 8);
  const name = `baci-oauth-${suffix}`;
  const db = `${name}-db`;
  const auth = `${name}-auth`;
  const dir = mkdtempSync(join(tmpdir(), 'baci-upstream-proof-'));
  const secret = 'disposable-local-auth-fixture-secret-only-not-production';
  let server;
  const docker = (...args) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const key = {
    ...privateKey.export({ format: 'jwk' }),
    kid: 'fixture-auth',
    alg: 'ES256',
    use: 'sig',
    key_ops: ['sign'],
  };
  function adminToken() {
    const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const text = `${enc({ alg: 'ES256', kid: 'fixture-auth', typ: 'JWT' })}.${enc({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 600 })}`;
    return `${text}.${sign('sha256', Buffer.from(text), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  }
  async function call(path, method, body, token) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    return {
      status: response.status,
      location: response.headers.get('location'),
      body: text ? JSON.parse(text) : {},
    };
  }
  let port;
  const close = async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const container of [auth, db])
      try {
        docker('rm', '-f', container);
      } catch {
        /* Owned fixture cleanup or readiness retry. */
      }
    try {
      docker('network', 'rm', name);
    } catch {
      /* Owned fixture cleanup or readiness retry. */
    }
    rmSync(dir, { recursive: true, force: true });
  };
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      void close().finally(() => process.exit(143));
    });
  try {
    docker('network', 'create', name);
    docker(
      'run',
      '-d',
      '--rm',
      '--name',
      db,
      '--network',
      name,
      '-e',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'
    );
    await waitForDatabase(docker, db);
    execFileSync(
      'docker',
      ['exec', '-i', db, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
      {
        input:
          'CREATE ROLE supabase_auth_admin LOGIN SUPERUSER; CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin; ALTER ROLE supabase_auth_admin SET search_path=auth;',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:P-256',
        '-nodes',
        '-keyout',
        `${dir}/key.pem`,
        '-out',
        `${dir}/cert.pem`,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
      ],
      { stdio: 'ignore' }
    );
    server = createServer(
      {
        key: readFileSync(`${dir}/key.pem`),
        cert: readFileSync(`${dir}/cert.pem`),
      },
      (req, res) => {
        const upstream = httpRequest(
          {
            hostname: '127.0.0.1',
            port,
            path: req.url,
            method: req.method,
            headers: req.headers,
          },
          (result) => {
            res.writeHead(result.statusCode, result.headers);
            result.pipe(res);
          }
        );
        upstream.on('error', () => {
          res.writeHead(502);
          res.end();
        });
        req.pipe(upstream);
      }
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const issuer = `https://127.0.0.1:${server.address().port}`;
    const env = {
      GOTRUE_API_HOST: '0.0.0.0',
      GOTRUE_API_PORT: '9999',
      API_EXTERNAL_URL: issuer,
      GOTRUE_SITE_URL: 'https://baci.example.invalid',
      GOTRUE_DB_DRIVER: 'postgres',
      GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin@${db}:5432/postgres?sslmode=disable`,
      GOTRUE_JWT_SECRET: secret,
      GOTRUE_JWT_KEYS: JSON.stringify([key]),
      GOTRUE_JWT_KEY_ID: 'fixture-auth',
      GOTRUE_JWT_ISSUER: issuer,
      GOTRUE_JWT_AUD: 'authenticated',
      GOTRUE_JWT_ADMIN_ROLES: 'service_role',
      GOTRUE_DISABLE_SIGNUP: 'false',
      GOTRUE_MAILER_AUTOCONFIRM: 'true',
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
      GOTRUE_OAUTH_SERVER_ENABLED: 'true',
      GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION: 'false',
      GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH: '/consent',
      GOTRUE_REFRESH_TOKEN_ROTATION_ENABLED: 'true',
      GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: '0',
    };
    docker(
      'run',
      '-d',
      '--name',
      auth,
      '--network',
      name,
      '-p',
      '127.0.0.1::9999',
      ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      'supabase/gotrue:v2.197.0@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b'
    );
    try {
      port = Number(docker('port', auth, '9999/tcp').split(':').at(-1));
    } catch {
      throw new Error('Local Auth container failed to start');
    }
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        if ((await call('/health')).status === 200) {
          ready = true;
          break;
        }
      } catch {
        /* Owned fixture cleanup or readiness retry. */
      }
      await setTimeout(150);
    }
    assert(ready, 'Local auth readiness');
    return { call, issuer, adminToken, close, port, suffix };
  } catch (error) {
    await close();
    throw error;
  }
}
