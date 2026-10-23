import { describe, expect, it } from 'vitest';
import { authorizeBuilderOperation } from './authorize';
import {
  builderAuthChallenge,
  builderToolPolicy,
  getBuilderCapabilities,
} from './tool-policy';
import type { BuilderIdentity, BuilderLiveOwner } from './types';

const actor = '10000000-0000-4000-8000-000000000001';
const store = '20000000-0000-4000-8000-000000000001';
const connection = '30000000-0000-4000-8000-000000000001';
const scopes = new Set([
  'storefront.read',
  'storefront.write',
  'storefront.publish',
] as const);
const identity: BuilderIdentity = {
  actorUserId: actor,
  connectionId: connection,
  grantVersion: 1,
  scopes,
  allowedMerchantIds: [store],
  allowCreateStore: true,
};
const live: BuilderLiveOwner = {
  actorUserId: actor,
  userActive: true,
  isOwner: true,
  merchantId: store,
  storeState: 'established',
  templateId: 'puck',
  rendererVersion: 'baci-home-six-v1',
  now: new Date('2026-10-21T10:00:00Z'),
  connection: {
    ...identity,
    status: 'active',
    expiresAt: '2026-10-22T00:00:00Z',
    revokedAt: null,
  },
};
describe('builder authorization intersections', () => {
  it('accepts freshly hydrated targets after provisioning without changing grant version', () => {
    const beforeCreate = { ...identity, allowedMerchantIds: [] };
    expect(
      authorizeBuilderOperation(
        beforeCreate,
        live,
        'get_storefront_status',
        store
      )
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    // Task 3 must reload canonical targets on the next authenticated request.
    // The token keeps its actor, connection, version and scopes unchanged.
    const nextRequest = {
      ...beforeCreate,
      allowedMerchantIds: live.connection.allowedMerchantIds,
      allowCreateStore: live.connection.allowCreateStore,
    };
    for (const tool of [
      'get_storefront_status',
      'update_storefront_draft',
    ] as const)
      expect(
        authorizeBuilderOperation(nextRequest, live, tool, store)
      ).toMatchObject({
        ok: true,
        context: { merchantId: store, grantVersion: beforeCreate.grantVersion },
      });
  });
  it('allows a consented live owner', () =>
    expect(
      authorizeBuilderOperation(
        identity,
        live,
        'update_storefront_draft',
        store
      )
    ).toMatchObject({ ok: true, context: { merchantId: store } }));
  it.each(['revoked', 'expired'] as const)('rejects %s connections', (status) =>
    expect(
      authorizeBuilderOperation(
        identity,
        { ...live, connection: { ...live.connection, status } },
        'get_storefront_status',
        store
      )
    ).toMatchObject({ ok: false, error: { code: 'CONNECTION_REVOKED' } }));
  it('rejects expired/malformed expiry and stale canonical grant versions', () => {
    for (const expiresAt of ['2026-10-20T00:00:00Z', 'invalid'])
      expect(
        authorizeBuilderOperation(
          identity,
          { ...live, connection: { ...live.connection, expiresAt } },
          'get_storefront_status',
          store
        ).ok
      ).toBe(false);
    expect(
      authorizeBuilderOperation(
        identity,
        { ...live, connection: { ...live.connection, grantVersion: 2 } },
        'publish_storefront',
        store
      )
    ).toMatchObject({ ok: false, error: { code: 'CONNECTION_REVOKED' } });
  });
  it('intersects token and canonical scopes; write does not imply read', () => {
    for (const [tokenScopes, grantScopes] of [
      [new Set(['storefront.write'] as const), scopes],
      [scopes, new Set(['storefront.read'] as const)],
    ])
      expect(
        authorizeBuilderOperation(
          { ...identity, scopes: tokenScopes },
          { ...live, connection: { ...live.connection, scopes: grantScopes } },
          'update_storefront_draft',
          store
        )
      ).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_SCOPE' } });
  });
  it('uses uniform not-found for non-consented targets, removed owners and staff', () => {
    for (const current of [
      { ...live, isOwner: false },
      { ...live, merchantId: actor },
      { ...live, connection: { ...live.connection, allowedMerchantIds: [] } },
    ])
      expect(
        authorizeBuilderOperation(
          identity,
          current,
          'get_storefront_status',
          store
        )
      ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(
      authorizeBuilderOperation(
        { ...identity, allowedMerchantIds: [] },
        live,
        'get_storefront_status',
        store
      )
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
  it('denies actor/connection substitutions and inactive users', () => {
    for (const current of [
      { ...live, actorUserId: store },
      { ...live, userActive: false },
      { ...live, connection: { ...live.connection, connectionId: actor } },
    ])
      expect(
        authorizeBuilderOperation(
          identity,
          current,
          'get_storefront_status',
          store
        ).ok
      ).toBe(false);
  });
  it('permits account-only provisioning only with explicit create consent on both sides', () => {
    const account = {
      ...live,
      isOwner: false,
      merchantId: null,
      storeState: 'none' as const,
      connection: { ...live.connection, allowedMerchantIds: [] },
    };
    expect(
      authorizeBuilderOperation(
        { ...identity, allowedMerchantIds: [] },
        account,
        'create_storefront_draft'
      )
    ).toMatchObject({ ok: true, context: { merchantId: null } });
    expect(
      authorizeBuilderOperation(
        { ...identity, allowCreateStore: false },
        account,
        'create_storefront_draft'
      ).ok
    ).toBe(false);
    expect(
      authorizeBuilderOperation(
        identity,
        {
          ...account,
          connection: { ...account.connection, allowCreateStore: false },
        },
        'create_storefront_draft'
      ).ok
    ).toBe(false);
    expect(
      authorizeBuilderOperation(identity, live, 'create_storefront_draft')
    ).toMatchObject({ ok: false, error: { code: 'STORE_ALREADY_EXISTS' } });
  });
  it('exposes empty account lists without granting access to existing unconsented stores', () => {
    expect(
      authorizeBuilderOperation(
        { ...identity, allowedMerchantIds: [] },
        live,
        'list_storefronts'
      )
    ).toMatchObject({ ok: true, context: { merchantId: null } });
  });
  it('fails closed for unsupported template/renderer while status remains readable', () => {
    for (const capabilities of [
      { templateId: 'custom', rendererVersion: 'baci-home-six-v1' },
      { templateId: 'puck', rendererVersion: null },
    ]) {
      const current = { ...live, ...capabilities };
      for (const operation of [
        'preview_storefront',
        'update_storefront_draft',
        'apply_storefront_operation',
        'publish_storefront',
      ] as const)
        expect(
          authorizeBuilderOperation(identity, current, operation, store)
        ).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_TEMPLATE' } });
      expect(
        authorizeBuilderOperation(
          identity,
          current,
          'get_storefront_status',
          store
        ).ok
      ).toBe(true);
      expect(
        getBuilderCapabilities(current.templateId, current.rendererVersion)
      ).toMatchObject({
        supported: false,
        canEdit: false,
        editorUrl: 'https://usebaci.com/builder',
      });
    }
  });
  it('pins discovery scopes, annotations and reauthorization challenges', () => {
    expect(Object.keys(builderToolPolicy)).toHaveLength(8);
    expect(builderToolPolicy.publish_storefront.securitySchemes).toEqual([
      { type: 'oauth2', scopes: ['storefront.read', 'storefront.publish'] },
    ]);
    expect(builderToolPolicy.publish_storefront.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    expect(builderToolPolicy.list_storefronts.annotations.readOnlyHint).toBe(
      true
    );
    expect(
      builderAuthChallenge('INSUFFICIENT_SCOPE', 'update_storefront_draft')
    ).toMatchObject({
      isError: true,
      _meta: {
        'mcp/www_authenticate': [
          expect.stringContaining('scope="storefront.read storefront.write"'),
        ],
      },
    });
  });
});
