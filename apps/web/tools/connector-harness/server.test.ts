// @vitest-environment node
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type StartedHarness, startHarnessServer } from './server';

/**
 * HTTP+DB runtime regressions for the R0 harness. Provisions a disposable
 * PostgreSQL cluster, applies the committed fixture plus the REAL R0
 * migration, and drives the actual HTTP surface. Requires local postgres
 * binaries (initdb, pg_ctl, psql); skipped with a warning when absent.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SQL = resolve(HERE, 'runtime-fixture.sql');
const MIGRATION_SQL = resolve(HERE, './grants-r0-fixture.sql');

const OWNER = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const OWNER_TWO = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';
const BRANCH_A = '44444444-4444-4444-a444-444444444444';
const BRANCH_B = '55555555-5555-4555-a555-555555555555';
const ORDER_A = 'a0000000-0000-4000-a000-000000000001';
const ORDER_B = 'a0000000-0000-4000-a000-000000000002';
const ORDER_FOREIGN = 'a0000000-0000-4000-a000-000000000003';
const OWNER_SECRET = `runtime-test-secret-${'x'.repeat(16)}`;
const GATEWAY_PASSWORD = 'runtime-gateway-pw';

describe('harness database outage responses', () => {
  it('returns 500 on refresh and revoke instead of blaming request input', async () => {
    const deadPort = await freePort();
    const server = await startHarnessServer({
      host: '127.0.0.1',
      port: 0,
      databaseUrl: `postgres://connector_gateway:test@127.0.0.1:${deadPort}/postgres`,
      ownerSecret: OWNER_SECRET,
      testOwnerUserId: OWNER,
      testMerchantId: MERCHANT_A,
    });
    try {
      for (const [path, body] of [
        ['/v0/refresh', { refresh_token: 'mcn_refresh_dead' }],
        ['/v0/revoke', { grant_id: '00000000-0000-4000-8000-000000000000' }],
      ] as const) {
        const response = await fetch(`${server.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${OWNER_SECRET}`,
          },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({
          code: 'UNKNOWN_OUTCOME',
        });
      }
    } finally {
      await server.close();
    }
  });
});

function hasPostgresBinaries(): boolean {
  try {
    execSync('command -v initdb pg_ctl psql', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const BINARIES_AVAILABLE = hasPostgresBinaries();
if (!BINARIES_AVAILABLE) {
  console.warn(
    'harness-runtime: postgres binaries missing; runtime suite skipped'
  );
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : null;
      probe.close(() => {
        if (port === null) {
          reject(new Error('no_free_port'));
        } else {
          resolvePort(port);
        }
      });
    });
  });
}

(BINARIES_AVAILABLE ? describe : describe.skip)(
  'harness runtime (HTTP + disposable Postgres)',
  () => {
    let pgdata = '';
    let pgPort = 0;
    let harness: StartedHarness | null = null;
    let wideToken = '';
    let wideRefresh = '';

    function psql(args: string[]): void {
      execFileSync(
        'psql',
        ['-h', '127.0.0.1', '-p', String(pgPort), '-d', 'postgres', ...args],
        { stdio: 'pipe' }
      );
    }

    async function post(
      path: string,
      credential: string,
      body: unknown
    ): Promise<{ status: number; json: Record<string, unknown> }> {
      const response = await fetch(`${harness?.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credential}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as Record<string, unknown>;
      return { status: response.status, json };
    }

    beforeAll(async () => {
      pgPort = await freePort();
      pgdata = mkdtempSync(`${tmpdir()}/conn-harness-rt-`);
      execFileSync('initdb', ['-D', pgdata, '-E', 'UTF8'], { stdio: 'pipe' });
      execFileSync(
        'pg_ctl',
        ['-D', pgdata, '-l', `${pgdata}.log`, '-o', `-p ${pgPort}`, 'start'],
        { stdio: 'pipe' }
      );
      psql(['-v', 'ON_ERROR_STOP=1', '-f', FIXTURE_SQL]);
      psql(['-v', 'ON_ERROR_STOP=1', '-f', MIGRATION_SQL]);
      psql([
        '-c',
        `ALTER ROLE connector_gateway LOGIN PASSWORD '${GATEWAY_PASSWORD}';`,
      ]);

      harness = await startHarnessServer({
        host: '127.0.0.1',
        port: 0,
        databaseUrl: `postgres://connector_gateway:${GATEWAY_PASSWORD}@127.0.0.1:${pgPort}/postgres`,
        ownerSecret: OWNER_SECRET,
        testOwnerUserId: OWNER,
        testMerchantId: MERCHANT_A,
      });

      const issued = await post('/v0/issue-token', OWNER_SECRET, {
        connection_id: 'mcn_runtime_owner',
        scopes: ['orders:read'],
        merchant_wide: true,
      });
      expect(issued.status).toBe(201);
      wideToken = issued.json.token as string;
      wideRefresh = issued.json.refresh_token as string;
    }, 180_000);

    afterAll(async () => {
      await harness?.close().catch(() => undefined);
      if (pgdata) {
        try {
          execFileSync('pg_ctl', ['-D', pgdata, 'stop', '-m', 'fast'], {
            stdio: 'pipe',
          });
        } catch {
          // Best effort; the temp directory is removed regardless.
        }
        rmSync(pgdata, { recursive: true, force: true });
        rmSync(`${pgdata}.log`, { force: true });
      }
    }, 60_000);

    it('distinguishes malformed JSON from oversized bodies', async () => {
      for (const [body, expected] of [
        ['{', 400],
        ['x'.repeat(1_000_001), 413],
      ] as const) {
        const response = await fetch(
          `${harness?.baseUrl}/v0/tools/orders.list`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${wideToken}`,
              'content-type': 'application/json',
            },
            body,
          }
        );
        expect(response.status).toBe(expected);
      }
    });

    it('rejects a foreign merchant selector on orders.list', async () => {
      const denied = await post('/v0/tools/orders.list', wideToken, {
        merchant_id: MERCHANT_B,
      });
      expect(denied.status).toBe(403);
      expect(denied.json.code).toBe('FORBIDDEN_SCOPE');
    });

    it('rejects a foreign merchant selector on orders.get', async () => {
      const denied = await post('/v0/tools/orders.get', wideToken, {
        merchant_id: MERCHANT_B,
        order_id: ORDER_A,
      });
      expect(denied.status).toBe(403);
      expect(denied.json.code).toBe('FORBIDDEN_SCOPE');
    });

    it('accepts matching and omitted merchant selectors', async () => {
      for (const body of [{ merchant_id: MERCHANT_A }, {}]) {
        const ok = await post('/v0/tools/orders.list', wideToken, body);
        expect(ok.status).toBe(200);
        expect(Array.isArray(ok.json.orders)).toBe(true);
      }
      const get = await post('/v0/tools/orders.get', wideToken, {
        merchant_id: MERCHANT_A,
        order_id: ORDER_A,
      });
      expect(get.status).toBe(200);
    });

    it('narrows merchant-wide reads to the requested branch', async () => {
      const narrowed = await post('/v0/tools/orders.list', wideToken, {
        branch_ids: [BRANCH_A],
      });
      expect(narrowed.status).toBe(200);
      const orders = narrowed.json.orders as Array<{
        id: string;
        branchId: string;
      }>;
      expect(orders.map((order) => order.id)).toEqual([ORDER_A]);
      expect(orders.every((order) => order.branchId === BRANCH_A)).toBe(true);
      expect(orders.some((order) => order.branchId === BRANCH_B)).toBe(false);
    });

    it('returns the whole merchant when branches are omitted or empty', async () => {
      for (const body of [{}, { branch_ids: [] as string[] }]) {
        const all = await post('/v0/tools/orders.list', wideToken, body);
        expect(all.status).toBe(200);
        const orders = all.json.orders as Array<{ id: string }>;
        expect(orders.map((order) => order.id).sort()).toEqual(
          [ORDER_A, ORDER_B].sort()
        );
      }
    });

    it('hides foreign orders and rejects unknown tokens', async () => {
      const foreign = await post('/v0/tools/orders.get', wideToken, {
        order_id: ORDER_FOREIGN,
      });
      expect(foreign.status).toBe(404);
      const unknown = await post('/v0/tools/orders.list', 'mcn_test_nope', {});
      expect(unknown.status).toBe(401);
    });

    it('denies inventory/analytics reads without the matching scope', async () => {
      for (const tool of ['inventory.levels', 'analytics.summary']) {
        const denied = await post(`/v0/tools/${tool}`, wideToken, {});
        expect(denied.status).toBe(403);
        expect(denied.json.code).toBe('FORBIDDEN_SCOPE');
      }
    });

    it('reads inventory levels narrowed to the requested branch', async () => {
      const issued = await post('/v0/issue-token', OWNER_SECRET, {
        connection_id: 'mcn_runtime_inventory',
        scopes: ['inventory:read'],
        merchant_wide: true,
      });
      expect(issued.status).toBe(201);
      const token = issued.json.token as string;

      const all = await post('/v0/tools/inventory.levels', token, {});
      expect(all.status).toBe(200);
      const levels = all.json.levels as Array<{
        sku: string | null;
        branchId: string | null;
        available: number;
        lowStock: boolean;
      }>;
      expect(levels).toHaveLength(3);

      const narrowed = await post('/v0/tools/inventory.levels', token, {
        branch_ids: [BRANCH_A],
      });
      expect(narrowed.status).toBe(200);
      const narrowedLevels = narrowed.json.levels as Array<{
        branchId: string;
      }>;
      expect(narrowedLevels).toHaveLength(2);
      expect(narrowedLevels.every((level) => level.branchId === BRANCH_A)).toBe(
        true
      );

      const foreign = await post('/v0/tools/inventory.levels', token, {
        merchant_id: MERCHANT_B,
      });
      expect(foreign.status).toBe(403);

      const badLimit = await post('/v0/tools/inventory.levels', token, {
        limit: 5000,
      });
      expect(badLimit.status).toBe(400);
    });

    it('aggregates analytics without leaking excluded branches', async () => {
      const issued = await post('/v0/issue-token', OWNER_SECRET, {
        connection_id: 'mcn_runtime_analytics',
        scopes: ['analytics:read'],
        merchant_wide: true,
      });
      expect(issued.status).toBe(201);
      const token = issued.json.token as string;

      const all = await post('/v0/tools/analytics.summary', token, {});
      expect(all.status).toBe(200);
      const summary = all.json.summary as {
        orders: { count: number; paidCount: number; paidRevenue: number };
        stock: {
          availableUnits: number;
          lowStockLevels: number;
          outOfStockLevels: number;
        };
      };
      expect(summary.orders.count).toBe(2);
      expect(summary.orders.paidCount).toBe(1);
      expect(summary.orders.paidRevenue).toBe(150);
      expect(summary.stock).toEqual({
        availableUnits: 9,
        lowStockLevels: 2,
        outOfStockLevels: 0,
      });

      const narrowed = await post('/v0/tools/analytics.summary', token, {
        branch_ids: [BRANCH_B],
      });
      expect(narrowed.status).toBe(200);
      const branchSummary = narrowed.json.summary as typeof summary;
      expect(branchSummary.orders.count).toBe(1);
      expect(branchSummary.orders.paidRevenue).toBe(0);
      expect(branchSummary.stock.availableUnits).toBe(1);

      const foreign = await post('/v0/tools/analytics.summary', token, {
        merchant_id: MERCHANT_B,
      });
      expect(foreign.status).toBe(403);
    });

    it('rotates credentials and enforces revocation', async () => {
      const rotated = await post('/v0/refresh', 'unused', {
        refresh_token: wideRefresh,
      });
      expect(rotated.status).toBe(200);
      const nextToken = rotated.json.token as string;

      const stale = await post('/v0/tools/orders.list', wideToken, {});
      expect(stale.status).toBe(401);
      const fresh = await post('/v0/tools/orders.list', nextToken, {});
      expect(fresh.status).toBe(200);
      wideToken = nextToken;
    });

    it('denies the very next call after revocation', async () => {
      const issued = await post('/v0/issue-token', OWNER_SECRET, {
        connection_id: 'mcn_runtime_revoke',
        scopes: ['orders:read'],
        merchant_wide: true,
      });
      expect(issued.status).toBe(201);
      const token = issued.json.token as string;
      const grantId = issued.json.grant_id as string;

      const before = await post('/v0/tools/orders.list', token, {});
      expect(before.status).toBe(200);

      const revoked = await post('/v0/revoke', OWNER_SECRET, {
        grant_id: grantId,
      });
      expect(revoked.status).toBe(200);
      expect(revoked.json.revoked).toBe(true);

      const denied = await post('/v0/tools/orders.list', token, {});
      expect(denied.status).toBe(401);
      expect(denied.json).toEqual({
        error: 'Connector access is invalid, revoked, or expired.',
        code: 'GRANT_REVOKED',
      });

      const refreshDenied = await post('/v0/refresh', 'unused', {
        refresh_token: issued.json.refresh_token as string,
      });
      expect(refreshDenied.status).toBe(401);
      expect(refreshDenied.json.code).toBe('GRANT_REVOKED');
    });

    it('isolates sequential user transactions without leakage', async () => {
      const issued = await post('/v0/issue-token', OWNER_SECRET, {
        connection_id: 'mcn_runtime_identity_a',
        scopes: ['orders:read'],
        merchant_wide: true,
      });
      expect(issued.status).toBe(201);
      const tokenA = issued.json.token as string;

      // Second user: merchant-B owner grant created directly as that user
      // (creation binds user_id to auth.uid(); the harness issuer is
      // pinned to the first test owner).
      const tokenB = `mcn_test_identity_${Date.now()}`;
      const hashB = createHash('sha256').update(tokenB).digest('hex');
      psql([
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `SET ROLE authenticated; ` +
          `SELECT set_config('request.jwt.claim.sub', '${OWNER_TWO}', true); ` +
          `SELECT set_config('request.jwt.claims', ` +
          `json_build_object('sub', '${OWNER_TWO}'::text)::text, true); ` +
          `SELECT public.create_connector_grant(` +
          `'${MERCHANT_B}'::uuid, 'mcn_runtime_identity_b', '{}'::uuid[], ` +
          `'{orders:read}'::text[], true, NULL, '${hashB}', NULL);`,
      ]);

      const first = await post('/v0/tools/orders.list', tokenA, {});
      expect(first.status).toBe(200);
      const firstOrders = first.json.orders as Array<{
        id: string;
        merchantId: string;
        paymentStatus: string;
        shippingStatus: string;
      }>;
      expect(firstOrders.map((order) => order.id).sort()).toEqual(
        [ORDER_A, ORDER_B].sort()
      );
      expect(
        firstOrders.every((order) => order.merchantId === MERCHANT_A)
      ).toBe(true);
      // Payment and shipping stay separate dimensions on every row.
      for (const order of firstOrders) {
        expect(typeof order.paymentStatus).toBe('string');
        expect(typeof order.shippingStatus).toBe('string');
      }

      const second = await post('/v0/tools/orders.list', tokenB, {});
      expect(second.status).toBe(200);
      const secondOrders = second.json.orders as Array<{ id: string }>;
      expect(secondOrders.map((order) => order.id)).toEqual([ORDER_FOREIGN]);

      // Cross-tenant reads stay invisible in both directions.
      const crossB = await post('/v0/tools/orders.get', tokenB, {
        order_id: ORDER_A,
      });
      expect(crossB.status).toBe(404);
      const selectorEscape = await post('/v0/tools/orders.list', tokenB, {
        merchant_id: MERCHANT_A,
      });
      expect(selectorEscape.status).toBe(403);

      // Switching back to the first user shows no residue from the second.
      const again = await post('/v0/tools/orders.list', tokenA, {});
      expect(again.status).toBe(200);
      const againOrders = again.json.orders as Array<{ id: string }>;
      expect(againOrders.map((order) => order.id).sort()).toEqual(
        [ORDER_A, ORDER_B].sort()
      );
    });
  }
);
