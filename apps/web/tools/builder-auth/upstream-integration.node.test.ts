import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request } from 'node:https';
import { test } from 'node:test';
import { startUpstreamFixture } from '../builder-oauth-spike/upstream-fixture.mjs';
import { requireString } from './test-browser.ts';
import { createUpstreamOAuth } from './upstream-client.ts';
import { getLinkedUser } from './user-client.ts';

test('production upstream adapter exchanges dedicated code and rejects outer state/nonce; browser family survives', {
  timeout: 120000,
}, async () => {
  const f = await startUpstreamFixture();
  try {
    const browser = await f.call('/signup', 'POST', {
      email: `builder-${f.suffix}@example.invalid`,
      password: `Local-${randomUUID()}-Aa1`,
    });
    assert.equal(browser.status, 200);
    const callback = 'https://auth.usebaci.com/upstream/callback';
    const client = await f.call(
      '/admin/oauth/clients',
      'POST',
      {
        client_name: 'Local builder Task3',
        client_type: 'confidential',
        redirect_uris: [callback],
        token_endpoint_auth_method: 'client_secret_post',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
      f.adminToken()
    );
    assert.equal(client.status, 201);
    const loopbackFetch: typeof fetch = async (input, init = {}) => {
      const u = new URL(String(input));
      assert.equal(u.origin, f.issuer);
      return new Promise((resolve, reject) => {
        const req = request(
          u,
          {
            rejectUnauthorized: false,
            agent: false,
            method: init.method,
            headers: Object.fromEntries(new Headers(init.headers)),
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(Buffer.from(c)));
            res.on('end', () =>
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: res.statusCode,
                  headers: res.headers as Record<string, string>,
                })
              )
            );
          }
        );
        req.on('error', reject);
        req.setTimeout(5000, () => req.destroy(new Error('Fixture timeout')));
        req.end(
          init.body instanceof URLSearchParams
            ? init.body.toString()
            : init.body
        );
      });
    };
    const upstream = await createUpstreamOAuth({
      issuer: f.issuer,
      clientId: client.body.client_id,
      clientSecret: client.body.client_secret,
      redirectUri: callback,
      fetchImpl: loopbackFetch,
    });
    async function link(corrupt?: 'state' | 'nonce' | 'verifier') {
      const start = await upstream.begin();
      const res = await fetch(
        `http://127.0.0.1:${f.port}${start.url.pathname}${start.url.search}`,
        { redirect: 'manual' }
      );
      assert.equal(res.status, 302);
      const id = new URL(
        requireString(res.headers.get('location'))
      ).searchParams.get('authorization_id');
      assert(id);
      const details = await f.call(
        `/oauth/authorizations/${id}`,
        'GET',
        undefined,
        browser.body.access_token
      );
      const approval = details.body.redirect_url
        ? details
        : await f.call(
            `/oauth/authorizations/${id}/consent`,
            'POST',
            { action: 'approve' },
            browser.body.access_token
          );
      const tx = {
        ...start.transaction,
        ...(corrupt ? { [corrupt]: 'x'.repeat(43) } : {}),
      };
      return upstream.complete(new URL(approval.body.redirect_url), tx);
    }
    for (const field of ['state', 'nonce', 'verifier'] as const)
      await assert.rejects(link(field), /Reconnect/);
    const a = await link();
    const b = await link();
    assert.equal(a.subject, b.subject);
    assert.notEqual(a.tokens.refreshToken, b.tokens.refreshToken);
    assert.notEqual(a.tokens.refreshToken, browser.body.refresh_token);
    const user = await getLinkedUser(
      {
        url: f.issuer,
        anonKey: 'fixture-public',
        fetchImpl: async (input, init) => {
          const u = new URL(String(input));
          assert.equal(u.origin, f.issuer);
          u.pathname = u.pathname.replace(/^\/auth\/v1/, '');
          return loopbackFetch(u, init);
        },
      },
      a.tokens.accessToken
    );
    assert.equal(user.actorUserId, a.subject);
    const [nextA, nextB, nextBrowser] = await Promise.all([
      upstream.refresh(a.tokens.refreshToken),
      upstream.refresh(b.tokens.refreshToken),
      f.call('/token?grant_type=refresh_token', 'POST', {
        refresh_token: browser.body.refresh_token,
      }),
    ]);
    assert.notEqual(nextA.refreshToken, nextB.refreshToken);
    assert.equal(nextBrowser.status, 200);
    assert.equal(
      (
        await f.call(
          '/logout?scope=local',
          'POST',
          undefined,
          nextA.accessToken
        )
      ).status,
      204
    );
    await assert.rejects(upstream.refresh(nextA.refreshToken));
    assert((await upstream.refresh(nextB.refreshToken)).accessToken);
    assert.equal(
      (
        await f.call('/token?grant_type=refresh_token', 'POST', {
          refresh_token: nextBrowser.body.refresh_token,
        })
      ).status,
      200
    );
  } finally {
    await f.close();
  }
});
