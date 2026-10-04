import { assert, describe, expect, it } from 'vitest';
import {
  connectorConnectionViewSchema,
  connectorConnectRequestSchema,
  connectorDisconnectRequestSchema,
  connectorGrantRecordSchema,
  connectorScopeSchema,
  connectorToolNameSchema,
} from '@/schemas/connector';

describe('connector schemas', () => {
  it('accepts the four read tools and read scopes only', () => {
    for (const tool of [
      'orders.list',
      'orders.get',
      'inventory.levels',
      'analytics.summary',
    ]) {
      expect(connectorToolNameSchema.safeParse(tool).success).toBe(true);
    }
    expect(connectorToolNameSchema.safeParse('orders.cancel').success).toBe(
      false
    );
    expect(connectorScopeSchema.safeParse('orders:read').success).toBe(true);
    expect(connectorScopeSchema.safeParse('orders:write').success).toBe(false);
  });

  it('validates a grant record row shape', () => {
    const parsed = connectorGrantRecordSchema.safeParse({
      id: '66666666-6666-6666-8666-666666666666',
      connection_id: 'mcn_r0_pilot',
      user_id: '33333333-3333-4333-8333-333333333333',
      merchant_id: '11111111-1111-4111-8111-111111111111',
      branch_ids: ['44444444-4444-4444-a444-444444444444'],
      merchant_wide: false,
      scopes: ['orders:read'],
      status: 'active',
      version: 1,
      expires_at: null,
      revoked_at: null,
      revoke_reason: null,
      created_at: '2026-10-01T12:00:00.000Z',
      updated_at: '2026-10-01T12:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown scopes, statuses, and non-positive versions', () => {
    const base = {
      id: '66666666-6666-6666-8666-666666666666',
      connection_id: 'mcn_r0_pilot',
      user_id: '33333333-3333-4333-8333-333333333333',
      merchant_id: '11111111-1111-4111-8111-111111111111',
      branch_ids: [],
      merchant_wide: false,
      scopes: ['orders:read'],
      status: 'active',
      version: 1,
      expires_at: null,
      revoked_at: null,
      revoke_reason: null,
      created_at: '2026-10-01T12:00:00.000Z',
      updated_at: '2026-10-01T12:00:00.000Z',
    };
    expect(
      connectorGrantRecordSchema.safeParse({
        ...base,
        scopes: ['orders:write'],
      }).success
    ).toBe(false);
    expect(
      connectorGrantRecordSchema.safeParse({ ...base, status: 'pending' })
        .success
    ).toBe(false);
    expect(
      connectorGrantRecordSchema.safeParse({ ...base, version: 0 }).success
    ).toBe(false);
  });

  it('rejects a grant scope until an exposed connector tool requires it', () => {
    const result = connectorConnectRequestSchema.safeParse({
      merchantId: '11111111-1111-4111-8111-111111111111',
      branchIds: ['22222222-2222-4222-8222-222222222222'],
      scopes: ['events:read'],
    });

    expect(result.success).toBe(false);
  });

  it('validates connect requests with safe defaults', () => {
    const parsed = connectorConnectRequestSchema.safeParse({
      merchantId: '11111111-1111-4111-8111-111111111111',
      scopes: ['orders:read'],
    });
    assert(parsed.success);
    expect(parsed.data).toMatchObject({
      branchIds: [],
      merchantWide: false,
      expiresInSeconds: 2592000,
    });
    expect(
      connectorConnectRequestSchema.safeParse({
        merchantId: '11111111-1111-4111-8111-111111111111',
        scopes: [],
      }).success
    ).toBe(false);
    expect(
      connectorConnectRequestSchema.safeParse({
        merchantId: '11111111-1111-4111-8111-111111111111',
        scopes: ['orders:write'],
      }).success
    ).toBe(false);
  });

  it('constrains the optional stable connection id', () => {
    const base = {
      merchantId: '11111111-1111-4111-8111-111111111111',
      scopes: ['orders:read'],
    };
    expect(
      connectorConnectRequestSchema.safeParse({
        ...base,
        connectionId: 'muse-desktop-main_01',
      }).success
    ).toBe(true);
    for (const connectionId of [
      '',
      'has spaces',
      'semi;colon',
      'x'.repeat(129),
    ]) {
      expect(
        connectorConnectRequestSchema.safeParse({ ...base, connectionId })
          .success
      ).toBe(false);
    }
  });

  it('rejects credential material in the connection view', () => {
    const base = {
      grantId: '66666666-6666-6666-8666-666666666666',
      connectionId: 'mcn_r0_pilot',
      merchantId: '11111111-1111-4111-8111-111111111111',
      branchIds: [],
      merchantWide: true,
      scopes: ['orders:read'],
      status: 'active',
      version: 1,
      expiresAt: null,
      usable: true,
    };
    expect(connectorConnectionViewSchema.safeParse(base).success).toBe(true);
    // Strict object: hash fields cannot sneak into the merchant view.
    expect(
      connectorConnectionViewSchema.safeParse({
        ...base,
        token_hash: 'ab'.repeat(32),
      }).success
    ).toBe(false);
  });

  it('validates disconnect requests', () => {
    expect(
      connectorDisconnectRequestSchema.safeParse({
        merchantId: '11111111-1111-4111-8111-111111111111',
        grantId: '66666666-6666-6666-8666-666666666666',
      }).success
    ).toBe(true);
    expect(
      connectorDisconnectRequestSchema.safeParse({
        merchantId: 'not-a-uuid',
        grantId: '66666666-6666-6666-8666-666666666666',
      }).success
    ).toBe(false);
  });
});
