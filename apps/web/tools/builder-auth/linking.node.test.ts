import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderConsentPage } from './consent-page.ts';
import { buildConsentDecision, validateConsentPost } from './linking.ts';

test('consent rejects forged target, missing read, CSRF and non-builder scopes', () => {
  const state = {
    actorUserId: '10000000-0000-4000-8000-000000000001',
    ownedMerchantId: null,
    requestedScopes: ['storefront.read', 'storefront.write'],
    csrf: 'trusted-unguessable-csrf',
    resource: 'https://builder-mcp.usebaci.com/builder/mcp',
  };
  assert.deepEqual(
    buildConsentDecision(
      state,
      new URLSearchParams({
        csrf: state.csrf,
        decision: 'approve',
        create: 'yes',
      })
    ),
    {
      scopes: ['storefront.read', 'storefront.write'],
      allowedMerchantIds: [],
      allowCreateStore: true,
    }
  );
  for (const form of [
    new URLSearchParams({ csrf: 'evil', decision: 'approve' }),
    new URLSearchParams({
      csrf: state.csrf,
      decision: 'approve',
      merchantId: 'other',
    }),
  ])
    assert.throws(() => buildConsentDecision(state, form));
  for (const scopes of [['storefront.write'], ['storefront.read', 'admin']])
    assert.throws(() =>
      buildConsentDecision(
        { ...state, requestedScopes: scopes },
        new URLSearchParams({ csrf: state.csrf, decision: 'approve' })
      )
    );
  assert.throws(() =>
    validateConsentPost(
      'https://evil.invalid',
      'https://auth.usebaci.com',
      'text/plain'
    )
  );
  assert.throws(() =>
    validateConsentPost(
      'https://auth.usebaci.com',
      'https://auth.usebaci.com',
      'application/json'
    )
  );
});
test('declined or unselected create consent cannot provision and owner target is derived server-side', () => {
  const state = {
    actorUserId: 'owner',
    ownedMerchantId: 'store',
    requestedScopes: ['storefront.read'],
    csrf: 'csrf',
    resource: 'https://builder-mcp.usebaci.com/builder/mcp',
  };
  assert.deepEqual(
    buildConsentDecision(
      state,
      new URLSearchParams({ csrf: 'csrf', decision: 'approve' })
    ),
    {
      scopes: ['storefront.read'],
      allowedMerchantIds: ['store'],
      allowCreateStore: false,
    }
  );
  assert.equal(
    buildConsentDecision(
      state,
      new URLSearchParams({ csrf: 'csrf', decision: 'deny' })
    ),
    null
  );
});

test('the broker identifies the linked store and explains only requested permissions', () => {
  const state = {
    actorUserId: 'owner',
    ownedMerchantId: 'synthetic-store',
    requestedScopes: ['storefront.read', 'storefront.write'],
    csrf: 'csrf',
    resource: 'https://builder-mcp.usebaci.com/builder/mcp',
  };
  const html = renderConsentPage(state, '/interaction/test', 'Orbit <QA>');
  assert.ok(html.includes('Orbit &lt;QA&gt;'));
  assert.ok(!html.includes('Orbit <QA>'));
  assert.ok(html.includes('Read your store and catalog'));
  assert.ok(html.includes('Edit your private storefront draft'));
  assert.ok(!html.includes('Request publication'));
  const noStore = renderConsentPage(
    { ...state, ownedMerchantId: null, requestedScopes: ['storefront.read'] },
    '/interaction/test',
    null
  );
  assert.ok(noStore.includes('No store is linked yet'));
  assert.ok(!noStore.includes('name="create"'));
  const publisher = renderConsentPage(
    { ...state, requestedScopes: ['storefront.read', 'storefront.publish'] },
    '/interaction/test',
    'Synthetic Orbit'
  );
  assert.ok(publisher.includes('Request publication'));
  assert.ok(publisher.includes('requires a separate confirmation in Baci'));
});
