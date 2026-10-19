import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { UserAccess } from '@/lib/api-permissions';
import { resolveConnectorAuthorization } from '@/lib/connector/authorize';
import {
  type ConnectorGrant,
  type ConnectorScope,
  isGrantUsable,
} from '@/lib/connector/grant';

/**
 * Recorded connect / refresh / revoke flow (R0 spike proof).
 *
 * This in-memory store models the exact lifecycle rules the database must
 * enforce: opaque tokens stored as hashes only, refresh rotation that
 * invalidates the previous token without expanding scopes, and revocation
 * that denies the very next call.
 */

interface StoredGrant extends ConnectorGrant {
  tokenHash: string;
  refreshTokenHash: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

class FakeGrantStore {
  private grants = new Map<string, StoredGrant>();
  private counter = 0;

  connect(input: {
    connectionId: string;
    userId: string;
    merchantId: string;
    branchIds: string[];
    scopes: ConnectorScope[];
  }): { grant: StoredGrant; token: string; refreshToken: string } {
    this.counter += 1;
    const token = `mcn_test_${this.counter}_access`;
    const refreshToken = `mcn_test_${this.counter}_refresh`;
    const grant: StoredGrant = {
      id: `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`,
      connectionId: input.connectionId,
      userId: input.userId,
      merchantId: input.merchantId,
      branchIds: [...input.branchIds],
      merchantWide: false,
      scopes: [...input.scopes],
      status: 'active',
      version: 1,
      expiresAt: null,
      revokedAt: null,
      tokenHash: sha256(token),
      refreshTokenHash: sha256(refreshToken),
    };
    this.grants.set(grant.id, grant);
    return { grant, token, refreshToken };
  }

  lookupByToken(token: string): StoredGrant | null {
    const hash = sha256(token);
    for (const grant of this.grants.values()) {
      if (grant.tokenHash === hash && isGrantUsable(grant)) return grant;
    }
    return null;
  }

  refresh(
    refreshToken: string,
    now: Date
  ): { grant: StoredGrant; token: string; refreshToken: string } | null {
    const hash = sha256(refreshToken);
    for (const grant of this.grants.values()) {
      if (grant.refreshTokenHash !== hash || !isGrantUsable(grant, now)) {
        continue;
      }
      this.counter += 1;
      const token = `mcn_test_${this.counter}_access`;
      const nextRefresh = `mcn_test_${this.counter}_refresh`;
      const rotated: StoredGrant = {
        ...grant,
        scopes: [...grant.scopes],
        branchIds: [...grant.branchIds],
        version: grant.version + 1,
        tokenHash: sha256(token),
        refreshTokenHash: sha256(nextRefresh),
      };
      this.grants.set(grant.id, rotated);
      return { grant: rotated, token, refreshToken: nextRefresh };
    }
    return null;
  }

  revoke(grantId: string, now: Date): boolean {
    const grant = this.grants.get(grantId);
    if (grant?.status !== 'active') return false;
    this.grants.set(grantId, {
      ...grant,
      status: 'revoked',
      revokedAt: now.toISOString(),
    });
    return true;
  }
}

const MERCHANT = '11111111-1111-1111-1111-111111111111';
const USER = '33333333-3333-3333-3333-333333333333';
const BRANCH = '44444444-4444-4444-4444-444444444444';
const NOW = new Date('2026-10-01T12:00:00.000Z');

const LIVE_ACCESS: UserAccess = {
  merchantId: MERCHANT,
  role: 'manager',
  isOwner: false,
  isStaff: true,
  permissions: { orders: { view: true } },
};

describe('connector grant lifecycle (recorded R0 flow)', () => {
  let store: FakeGrantStore;

  beforeEach(() => {
    store = new FakeGrantStore();
  });

  it('connects one test merchant with a branch-scoped staff grant', () => {
    const { grant, token } = store.connect({
      connectionId: 'mcn_r0_pilot',
      userId: USER,
      merchantId: MERCHANT,
      branchIds: [BRANCH],
      scopes: ['orders:read'],
    });

    expect(token).toMatch(/^mcn_test_/);
    expect(grant.tokenHash).not.toContain(token);

    const lookedUp = store.lookupByToken(token);
    expect(lookedUp?.id).toBe(grant.id);

    const authz =
      lookedUp === null
        ? null
        : resolveConnectorAuthorization({
            grant: lookedUp,
            liveAccess: LIVE_ACCESS,
            userActive: true,
            tool: 'orders.list',
            requestedBranchIds: [BRANCH],
            now: NOW,
          });
    expect(authz?.ok).toBe(true);
  });

  it('rotates tokens on refresh without expanding scope', () => {
    const first = store.connect({
      connectionId: 'mcn_r0_pilot',
      userId: USER,
      merchantId: MERCHANT,
      branchIds: [BRANCH],
      scopes: ['orders:read'],
    });

    const refreshed = store.refresh(first.refreshToken, NOW);
    expect(refreshed).not.toBeNull();
    expect(refreshed?.grant.scopes).toEqual(['orders:read']);
    expect(refreshed?.grant.branchIds).toEqual([BRANCH]);
    expect(refreshed?.grant.version).toBe(first.grant.version + 1);

    // Previous access and refresh tokens no longer resolve.
    expect(store.lookupByToken(first.token)).toBeNull();
    expect(store.refresh(first.refreshToken, NOW)).toBeNull();

    // Rotated token authorizes the same narrow grant.
    const lookedUp =
      refreshed === null ? null : store.lookupByToken(refreshed.token);
    expect(lookedUp?.id).toBe(first.grant.id);
  });

  it('denies the next call after revocation', () => {
    const { grant, token } = store.connect({
      connectionId: 'mcn_r0_pilot',
      userId: USER,
      merchantId: MERCHANT,
      branchIds: [BRANCH],
      scopes: ['orders:read'],
    });
    expect(store.lookupByToken(token)?.id).toBe(grant.id);

    expect(store.revoke(grant.id, NOW)).toBe(true);

    // Token lookup fails closed.
    expect(store.lookupByToken(token)).toBeNull();

    // Authorization rejects a grant carrying the current revoked state.
    // A previously copied active snapshot needs a fresh store lookup above.
    const authz = resolveConnectorAuthorization({
      grant: { ...grant, status: 'revoked', revokedAt: NOW.toISOString() },
      liveAccess: LIVE_ACCESS,
      userActive: true,
      tool: 'orders.list',
      requestedBranchIds: [BRANCH],
      now: NOW,
    });
    expect(authz.ok).toBe(false);
    if (!authz.ok) {
      expect(authz.body.code).toBe('GRANT_REVOKED');
    }
  });

  it('rejects unknown tokens', () => {
    expect(store.lookupByToken('mcn_test_unknown')).toBeNull();
    expect(store.refresh('mcn_test_unknown_refresh', NOW)).toBeNull();
  });
});
