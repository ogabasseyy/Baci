import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createUpstreamClient } from './upstream-client.mjs';
import { startUpstreamFixture } from './upstream-fixture.mjs';

const checks = [];
const fixture = await startUpstreamFixture();
const { call, issuer, adminToken, port, suffix } = fixture;
try {
  const browser = await call('/signup', 'POST', {
    email: `owner-${suffix}@example.invalid`,
    password: `Local-only-${randomUUID()}-Aa1`,
  });
  assert.equal(browser.status, 200, 'Unexpected local OAuth response');
  assert(browser.body.access_token);
  const client = await call(
    '/admin/oauth/clients',
    'POST',
    {
      client_name: 'Baci local nested broker',
      client_type: 'confidential',
      redirect_uris: ['https://auth.usebaci.com/upstream/callback'],
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    adminToken()
  );
  assert.equal(client.status, 201, 'Unexpected local OAuth response');
  const { oidc, config } = await createUpstreamClient(issuer, client);
  checks.push('real upstream discovery and confidential predefined client');
  async function link(overrides = {}) {
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: 'https://auth.usebaci.com/upstream/callback',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const response = await fetch(
      `http://127.0.0.1:${port}${url.pathname}${url.search}`,
      { redirect: 'manual' }
    );
    assert.equal(response.status, 302);
    const consent = new URL(response.headers.get('location'));
    const id = consent.searchParams.get('authorization_id');
    assert(id);
    const details = await call(
      `/oauth/authorizations/${id}`,
      'GET',
      undefined,
      browser.body.access_token
    );
    assert.equal(details.status, 200, 'Unexpected local OAuth response');
    const approved = details.body.redirect_url
      ? { status: 200, body: details.body }
      : await call(
          `/oauth/authorizations/${id}/consent`,
          'POST',
          { action: 'approve' },
          browser.body.access_token
        );
    assert.equal(approved.status, 200, 'Unexpected local OAuth response');
    const callback = new URL(approved.body.redirect_url);
    return oidc.authorizationCodeGrant(config, callback, {
      pkceCodeVerifier: verifier,
      expectedState: state,
      expectedNonce: nonce,
      ...overrides,
    });
  }
  await assert.rejects(() => link({ expectedState: 'outer-state' }));
  await assert.rejects(() => link({ expectedNonce: 'outer-nonce' }));
  await assert.rejects(() => link({ pkceCodeVerifier: 'x'.repeat(43) }));
  checks.push('inner state nonce and PKCE reject outer-flow substitution');
  const a = await link();
  const b = await link();
  assert(a.refresh_token && b.refresh_token);
  assert.notEqual(a.refresh_token, b.refresh_token);
  assert.equal(a.claims().sub, b.claims().sub);
  checks.push('two independent nested code PKCE links with stable subject');
  const user = await oidc.fetchUserInfo(config, a.access_token, a.claims().sub);
  assert.equal(user.email_verified, true);
  assert.equal(user.sub, a.claims().sub);
  checks.push('verified email and stable UserInfo subject');
  const [browserRefreshed, nextA, nextB] = await Promise.all([
    call('/token?grant_type=refresh_token', 'POST', {
      refresh_token: browser.body.refresh_token,
    }),
    oidc.refreshTokenGrant(config, a.refresh_token),
    oidc.refreshTokenGrant(config, b.refresh_token),
  ]);
  assert.equal(browserRefreshed.status, 200);
  assert(nextA.refresh_token && nextB.refresh_token);
  checks.push('browser and both upstream refreshes remain independent');
  assert.equal(
    (await call('/logout?scope=local', 'POST', undefined, nextA.access_token))
      .status,
    204
  );
  await assert.rejects(() =>
    oidc.refreshTokenGrant(config, nextA.refresh_token)
  );
  const survivor = await oidc.refreshTokenGrant(config, nextB.refresh_token);
  assert(survivor.refresh_token);
  const browserSurvivor = await call(
    '/token?grant_type=refresh_token',
    'POST',
    { refresh_token: browserRefreshed.body.refresh_token }
  );
  assert.equal(browserSurvivor.status, 200);
  checks.push(
    'local disconnect revokes only one link and preserves browser and second link'
  );
  const reauthorized = await link();
  assert.equal(reauthorized.claims().sub, a.claims().sub);
  checks.push('reauthorization preserves subject without email merging');
  assert.equal(
    (
      await call(
        `/user/oauth/grants?client_id=${client.body.client_id}`,
        'DELETE',
        undefined,
        browserSurvivor.body.access_token
      )
    ).status,
    204
  );
  await assert.rejects(() =>
    oidc.refreshTokenGrant(config, survivor.refresh_token)
  );
  await assert.rejects(() =>
    oidc.refreshTokenGrant(config, reauthorized.refresh_token)
  );
  checks.push('explicit whole-client grant revocation invalidates both links');
  console.log(
    JSON.stringify({
      auth: 'supabase/gotrue:v2.197.0',
      client: 'openid-client@6.8.8',
      checks,
      scope: 'local upstream fixture; not a production provider acceptance',
    })
  );
} finally {
  await fixture.close();
}
