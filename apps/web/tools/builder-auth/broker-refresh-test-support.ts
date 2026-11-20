import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { generateKeyPair } from 'jose';
import { jwtVerify } from 'jose';
import { type createTestBrowser, requireString } from './test-browser.ts';
import type { databaseFixture } from './test-fixtures.ts';

export async function checkBrokerRefresh(input: {
  authorize(
    changeTarget?: boolean
  ): Promise<{ access_token: string; refresh_token: string }>;
  browser: ReturnType<typeof createTestBrowser>;
  authPath: string;
  key: Awaited<ReturnType<typeof generateKeyPair>>;
  db: Awaited<ReturnType<typeof databaseFixture>>;
  actor: string;
  issuer: string;
  resource: string;
}) {
  const { authorize, browser, authPath, key, db, actor, issuer, resource } =
    input;
  const { send, jar } = browser;
  const tokens = await authorize();
  const verified = await jwtVerify(tokens.access_token, key.publicKey, {
    issuer,
    audience: resource,
    algorithms: ['ES256'],
    typ: 'at+jwt',
  });
  const id = String(verified.payload.connectionId);
  assert.equal(verified.payload.sub, actor);
  assert.equal(verified.payload.grantVersion, 1);
  assert.equal((await db.storage.readConnection(id))?.allowCreateStore, true);
  const refreshed = await send('/token', {
    client_id: 'new-builder-client',
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    resource,
  });
  assert.equal(refreshed.status, 200);
  const next = JSON.parse(refreshed.text) as { refresh_token: string };
  assert.notEqual(next.refresh_token, tokens.refresh_token);
  const second = await authorize();
  const secondClaims = await jwtVerify(second.access_token, key.publicKey, {
    issuer,
    audience: resource,
  });
  const secondId = String(secondClaims.payload.connectionId);
  assert.notEqual(secondId, id);
  const reused = await send('/token', {
    client_id: 'new-builder-client',
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    resource,
  });
  assert.notEqual(reused.status, 200);
  assert.equal((await db.storage.readConnection(id))?.status, 'revoked');
  assert.equal((await db.storage.readConnection(secondId))?.status, 'active');
  const noResource = await send('/token', {
    client_id: 'new-builder-client',
    grant_type: 'refresh_token',
    refresh_token: second.refresh_token,
  });
  assert.notEqual(noResource.status, 200);
  await db.storage.revoke(secondId);
  assert.equal((await db.storage.readConnection(secondId))?.status, 'revoked');
  await assert.rejects(authorize(true), /Consent target changed/);
  // An invalid callback clears the host-only cookie; a fresh request can restart.
  const bad = await send('/upstream/callback?state=invalid');
  assert.equal(bad.status, 400);
  assert(!jar.has('__Host-baci-builder-link'));
  const start = await send(authPath);
  const login = await send(requireString(start.location));
  assert.equal(
    new URL(requireString(login.location)).origin,
    'https://upstream.invalid'
  );
}

export function createBrokerTestCertificate(dir: string) {
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
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' }
  );
}
