import { describe, expect, it } from 'vitest';
import type { UserAccess } from '@/lib/api-permissions';
import {
  CONNECTOR_POLICY_VERSION,
  resolveConnectorAuthorization,
} from '@/lib/connector/authorize';
import type { ConnectorGrant } from '@/lib/connector/grant';

const MERCHANT_A = '11111111-1111-1111-1111-111111111111';
const MERCHANT_B = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const BRANCH_1 = '44444444-4444-4444-4444-444444444444';
const BRANCH_2 = '55555555-5555-5555-5555-555555555555';
const NOW = new Date('2026-10-01T12:00:00.000Z');

function grant(overrides: Partial<ConnectorGrant> = {}): ConnectorGrant {
  return {
    id: '66666666-6666-6666-6666-666666666666',
    connectionId: 'mcn_test_connection',
    userId: USER_ID,
    merchantId: MERCHANT_A,
    branchIds: [BRANCH_1],
    merchantWide: false,
    scopes: ['orders:read'],
    status: 'active',
    version: 3,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function staffAccess(overrides: Partial<UserAccess> = {}): UserAccess {
  return {
    merchantId: MERCHANT_A,
    role: 'manager',
    isOwner: false,
    isStaff: true,
    permissions: { orders: { view: true } },
    ...overrides,
  };
}

describe('resolveConnectorAuthorization', () => {
  it('authorizes a branch-scoped read inside the grant', () => {
    const result = resolveConnectorAuthorization({
      grant: grant(),
      liveAccess: staffAccess(),
      userActive: true,
      tool: 'orders.list',
      requestedBranchIds: [BRANCH_1],
      now: NOW,
    });

    expect(result).toEqual({
      ok: true,
      context: {
        userId: USER_ID,
        merchantId: MERCHANT_A,
        branchIds: [BRANCH_1],
        grantId: '66666666-6666-6666-6666-666666666666',
        grantVersion: 3,
        policyVersion: CONNECTOR_POLICY_VERSION,
      },
    });
  });

  it('denies a merchant selector outside the grant (selectors are not authority)', () => {
    const result = resolveConnectorAuthorization({
      grant: grant(),
      liveAccess: staffAccess(),
      userActive: true,
      tool: 'orders.list',
      requestedMerchantId: MERCHANT_B,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('FORBIDDEN_SCOPE');
    }
  });

  it('denies live access bound to a different merchant (cross-tenant)', () => {
    const result = resolveConnectorAuthorization({
      grant: grant(),
      liveAccess: staffAccess({ merchantId: MERCHANT_B }),
      userActive: true,
      tool: 'orders.list',
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('FORBIDDEN_SCOPE');
    }
  });

  it('denies a branch selector outside the allowlist', () => {
    const result = resolveConnectorAuthorization({
      grant: grant(),
      liveAccess: staffAccess(),
      userActive: true,
      tool: 'orders.list',
      requestedBranchIds: [BRANCH_1, BRANCH_2],
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('BRANCH_NOT_ALLOWED');
    }
  });

  it('defaults to the grant allowlist when no branches are requested', () => {
    const result = resolveConnectorAuthorization({
      grant: grant(),
      liveAccess: staffAccess(),
      userActive: true,
      tool: 'orders.list',
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.branchIds).toEqual([BRANCH_1]);
    }
  });

  it('treats an empty selector list like no selector', () => {
    const scoped = resolveConnectorAuthorization({
      grant: grant(),
      liveAccess: staffAccess(),
      userActive: true,
      tool: 'orders.list',
      requestedBranchIds: [],
      now: NOW,
    });
    expect(scoped.ok).toBe(true);
    if (scoped.ok) {
      expect(scoped.context.branchIds).toEqual([BRANCH_1]);
    }

    const wide = resolveConnectorAuthorization({
      grant: grant({ merchantWide: true, branchIds: [] }),
      liveAccess: staffAccess({
        isOwner: true,
        isStaff: false,
        role: 'owner',
        permissions: {},
      }),
      userActive: true,
      tool: 'orders.list',
      requestedBranchIds: [],
      now: NOW,
    });
    expect(wide.ok).toBe(true);
    if (wide.ok) {
      expect(wide.context.branchIds).toBeNull();
    }
  });

  it('denies the next call after revocation', () => {
    const result = resolveConnectorAuthorization({
      grant: grant({
        status: 'revoked',
        revokedAt: '2026-10-01T11:00:00.000Z',
      }),
      liveAccess: staffAccess(),
      userActive: true,
      tool: 'orders.list',
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('GRANT_REVOKED');
    }
  });

  it('denies expired grants', () => {
    const result = resolveConnectorAuthorization({
      grant: grant({ expiresAt: '2026-10-01T11:59:59.999Z' }),
      liveAccess: staffAccess(),
      userActive: true,
      tool: 'orders.list',
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('GRANT_EXPIRED');
    }
  });

  it('denies suspended users on the next call', () => {
    const result = resolveConnectorAuthorization({
      grant: grant(),
      liveAccess: staffAccess(),
      userActive: false,
      tool: 'orders.list',
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('USER_SUSPENDED');
    }
  });

  it('denies removed roles on the next call (missing live access)', () => {
    const result = resolveConnectorAuthorization({
      grant: grant(),
      liveAccess: null,
      userActive: true,
      tool: 'orders.list',
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('ROLE_REMOVED');
    }
  });

  it('denies when the live role lost the tool permission', () => {
    const result = resolveConnectorAuthorization({
      grant: grant(),
      liveAccess: staffAccess({ permissions: { orders: { view: false } } }),
      userActive: true,
      tool: 'orders.list',
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('ROLE_REMOVED');
    }
  });

  it('denies scopes absent from the grant (deny by default)', () => {
    const result = resolveConnectorAuthorization({
      grant: grant(),
      liveAccess: staffAccess({
        permissions: { orders: { view: true }, analytics: { view: true } },
      }),
      userActive: true,
      tool: 'analytics.summary',
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('FORBIDDEN_SCOPE');
    }
  });

  it('rejects stale grant versions (concurrency)', () => {
    const result = resolveConnectorAuthorization({
      grant: grant({ version: 4 }),
      liveAccess: staffAccess(),
      userActive: true,
      tool: 'orders.list',
      expectedGrantVersion: 3,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.code).toBe('VERSION_CONFLICT');
    }
  });

  it('grants merchant-wide access to owners only', () => {
    const ownerAccess = staffAccess({
      isOwner: true,
      isStaff: false,
      role: 'owner',
      permissions: {},
    });
    const allowed = resolveConnectorAuthorization({
      grant: grant({ merchantWide: true, branchIds: [] }),
      liveAccess: ownerAccess,
      userActive: true,
      tool: 'orders.list',
      now: NOW,
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.context.branchIds).toBeNull();
    }

    const staffDenied = resolveConnectorAuthorization({
      grant: grant({ merchantWide: true, branchIds: [] }),
      liveAccess: staffAccess(),
      userActive: true,
      tool: 'orders.list',
      now: NOW,
    });
    expect(staffDenied.ok).toBe(false);
    if (!staffDenied.ok) {
      expect(staffDenied.body.code).toBe('FORBIDDEN_SCOPE');
    }
  });

  it('never leaks aggregate access from an empty branch allowlist', () => {
    const result = resolveConnectorAuthorization({
      grant: grant({ branchIds: [] }),
      liveAccess: staffAccess(),
      userActive: true,
      tool: 'orders.list',
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.branchIds).toEqual([]);
    }
  });
});
