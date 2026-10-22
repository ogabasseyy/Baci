import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { databaseFixture } from './test-fixtures.ts';

test('Data API accepts normal upstream authority but rejects a builder token and private schemas', {
  timeout: 90000,
}, async () => {
  const db = await databaseFixture();
  const api = `baci-builder-rest-${randomUUID().slice(0, 8)}`;
  const docker = (...args: string[]) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  try {
    const actor = '10000000-0000-4000-8000-000000000001';
    const merchant = '30000000-0000-4000-8000-000000000001';
    await db.pool.query('INSERT INTO auth.users VALUES($1)', [actor]);
    await db.pool.query('INSERT INTO public.merchants VALUES($1,$2)', [
      merchant,
      actor,
    ]);
    await db.pool.query(
      'CREATE ROLE builder_rest_fixture LOGIN NOINHERIT;GRANT anon,authenticated TO builder_rest_fixture;'
    );
    const upstream = await generateKeyPair('ES256', { extractable: true });
    const builder = await generateKeyPair('ES256');
    const ip = docker(
      'inspect',
      db.containerName,
      '--format',
      '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
    );
    const jwks = JSON.stringify({
      keys: [
        {
          ...(await exportJWK(upstream.publicKey)),
          kid: 'upstream',
          alg: 'ES256',
        },
      ],
    });
    docker(
      'run',
      '--rm',
      '-d',
      '--name',
      api,
      '-p',
      '127.0.0.1::3000',
      '-e',
      `PGRST_DB_URI=postgres://builder_rest_fixture@${ip}:5432/postgres`,
      '-e',
      'PGRST_DB_ANON_ROLE=anon',
      '-e',
      'PGRST_DB_SCHEMAS=public',
      '-e',
      'PGRST_JWT_AUD=authenticated',
      '-e',
      `PGRST_JWT_SECRET=${jwks}`,
      'public.ecr.aws/supabase/postgrest@sha256:85258123312dc496ad4c2ed832154a65e9746f84df0d6d09b44229ff9230c08e'
    );
    const address = docker('port', api, '3000/tcp');
    assert.match(address, /^127\.0\.0\.1:\d+$/);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(`http://${address}/`, {
          signal: AbortSignal.timeout(1000),
        });
        if (r.status < 500) {
          ready = true;
          break;
        }
      } catch {
        /* startup */
      }
      await delay(100);
    }
    assert(ready);
    const ordinary = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'upstream' })
      .setAudience('authenticated')
      .setSubject(actor)
      .setExpirationTime('5m')
      .sign(upstream.privateKey);
    const outer = await new SignJWT({
      connectionId: randomUUID(),
      grantVersion: 1,
      scope: 'storefront.read storefront.write',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'builder', typ: 'at+jwt' })
      .setIssuer('https://auth.usebaci.com')
      .setAudience('https://mcp.usebaci.com/builder/mcp')
      .setSubject(actor)
      .setExpirationTime('5m')
      .sign(builder.privateKey);
    const valid = await fetch(`http://${address}/merchants?select=id`, {
      headers: { authorization: `Bearer ${ordinary}` },
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), [{ id: merchant }]);
    const invalid = await fetch(`http://${address}/merchants?select=id`, {
      headers: { authorization: `Bearer ${outer}` },
    });
    assert.equal(invalid.status, 401);
    const privateSchema = await fetch(
      `http://${address}/sessions?select=connection_id`,
      {
        headers: {
          authorization: `Bearer ${ordinary}`,
          'accept-profile': 'builder_authorization',
        },
      }
    );
    assert.notEqual(privateSchema.status, 200);
  } finally {
    try {
      docker('rm', '-f', api);
    } catch {
      /* owned cleanup */
    }
    await db.close();
  }
});
