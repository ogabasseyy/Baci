// @vitest-environment node
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type StartedGateway, startGatewayServer } from './server';

/**
 * HTTP+DB runtime regressions for the R1 read-only gateway. Provisions a
 * disposable PostgreSQL cluster, applies the committed fixture plus the
 * combined production connector migration, and drives the actual HTTP
 * surface. Requires local postgres binaries (initdb, pg_ctl, psql);
 * skipped with a warning when absent.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SQL = resolve(HERE, '../connector-harness/runtime-fixture.sql');
const PRODUCTION_MIGRATION_SQL = resolve(
  HERE,
  '../../../../supabase/migrations/20261004071747_connector_readonly_production.sql'
);

const PUBLIC_BASE_URL = 'https://connector.staging.example.com';
const OWNER = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
const MERCHANT_B = '22222222-2222-4222-8222-222222222222';
const BRANCH_A = '44444444-4444-4444-a444-444444444444';
const BRANCH_B = '55555555-5555-4555-a555-555555555555';
const ORDER_A = 'a0000000-0000-4000-a000-000000000001';
const OWNER_SECRET = `runtime-test-secret-${'x'.repeat(16)}`;
const GATEWAY_PASSWORD = 'runtime-gateway-pw';

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
    'gateway-runtime: postgres binaries missing; runtime suite skipped'
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
  'gateway runtime (HTTP + disposable Postgres)',
  () => {
    let pgdata = '';
    let pgPort = 0;
    let gateway: StartedGateway | null = null;
    let connectionSeq = 0;

    function psql(args: string[]): void {
      execFileSync(
        'psql',
        ['-h', '127.0.0.1', '-p', String(pgPort), '-d', 'postgres', ...args],
        { stdio: 'pipe' }
      );
    }

    function psqlQuery(query: string): string {
      return execFileSync(
        'psql',
        [
          '-h',
          '127.0.0.1',
          '-p',
          String(pgPort),
          '-d',
          'postgres',
          '-tA',
          '-F',
          '|',
          '-c',
          query,
        ],
        { encoding: 'utf8' }
      ).trim();
    }

    async function post(
      path: string,
      credential: string | null,
      body: unknown
    ): Promise<{
      status: number;
      json: Record<string, unknown>;
      retryAfter: string | null;
    }> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (credential !== null) {
        headers.authorization = `Bearer ${credential}`;
      }
      const response = await fetch(`${gateway?.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as Record<string, unknown>;
      return {
        status: response.status,
        json,
        retryAfter: response.headers.get('retry-after'),
      };
    }

    async function issueToken(extra: Record<string, unknown> = {}): Promise<{
      grantId: string;
      token: string;
      refreshToken: string;
    }> {
      connectionSeq += 1;
      const issued = await post('/v0/issue-token', OWNER_SECRET, {
        connection_id: `mcn_gateway_rt_${connectionSeq}`,
        scopes: ['orders:read'],
        merchant_wide: true,
        ...extra,
      });
      expect(issued.status).toBe(201);
      return {
        grantId: issued.json.grant_id as string,
        token: issued.json.token as string,
        refreshToken: issued.json.refresh_token as string,
      };
    }

    beforeAll(async () => {
      pgPort = await freePort();
      pgdata = mkdtempSync(`${tmpdir()}/conn-gateway-rt-`);
      execFileSync('initdb', ['-D', pgdata, '-E', 'UTF8'], { stdio: 'pipe' });
      execFileSync(
        'pg_ctl',
        ['-D', pgdata, '-l', `${pgdata}.log`, '-o', `-p ${pgPort}`, 'start'],
        { stdio: 'pipe' }
      );
      psql(['-v', 'ON_ERROR_STOP=1', '-f', FIXTURE_SQL]);
      psql(['-v', 'ON_ERROR_STOP=1', '-f', PRODUCTION_MIGRATION_SQL]);
      psql([
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        resolve(
          HERE,
          '../../../../supabase/migrations/20261004184006_connector_request_fingerprint.sql'
        ),
      ]);
      psql([
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        resolve(
          HERE,
          '../../../../supabase/migrations/20261004071806_connector_grant_management_ownership.sql'
        ),
      ]);
      psql([
        '-c',
        `ALTER ROLE connector_gateway LOGIN PASSWORD '${GATEWAY_PASSWORD}';`,
      ]);

      gateway = await startGatewayServer({
        host: '127.0.0.1',
        port: 0,
        databaseUrl: `postgres://connector_gateway:${GATEWAY_PASSWORD}@127.0.0.1:${pgPort}/postgres`,
        localGrantManagement: {
          ownerSecret: OWNER_SECRET,
          ownerUserId: OWNER,
          merchantId: MERCHANT_A,
        },
        publicBaseUrl: PUBLIC_BASE_URL,
        rateLimitPerKey: 4,
        rateLimitPerIp: 1000,
        rateLimitWindowMs: 60_000,
        trustedProxies: ['127.0.0.1', '::1'],
      });
    }, 180_000);

    it('scopes uniqueness guards to the connector table despite same-name constraints', () => {
      psql([
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        resolve(
          HERE,
          '../../../../supabase/migrations/tests/connector_grant_constraint_guards.sql'
        ),
      ]);
    });

    it('persists retry receipts under the owner session and rejects other callers', () => {
      psql([
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        resolve(
          HERE,
          '../../../../supabase/migrations/tests/connector_request_fingerprint.sql'
        ),
      ]);
    });

    it('distinguishes malformed JSON from oversized bodies', async () => {
      const { token } = await issueToken();
      for (const [body, expected] of [
        ['{', 400],
        ['x'.repeat(1_000_001), 413],
      ] as const) {
        const response = await fetch(
          `${gateway?.baseUrl}/v0/tools/orders.list`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body,
          }
        );
        expect(response.status).toBe(expected);
      }
    });

    it('denies reissue of another user grant and staff revocation of owner grants', async () => {
      const { grantId } = await issueToken();
      psql([
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `
        BEGIN;
        INSERT INTO auth.users (id) VALUES ('eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee');
        INSERT INTO public.staff_members (id, merchant_id, user_id, role, status)
        VALUES ('ffffffff-ffff-4fff-afff-ffffffffffff', '${MERCHANT_A}',
          'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee', 'admin', 'active');
        SELECT set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee', true);
        DO $$ BEGIN
          BEGIN
            PERFORM public.revoke_connector_grant('${grantId}', 'staff test');
            RAISE EXCEPTION 'staff revoked another user grant';
          EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        END $$;
        UPDATE public.connector_grants SET user_id = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'
        WHERE id = '${grantId}';
        SELECT set_config('request.jwt.claim.sub', '${OWNER}', true);
        DO $$ BEGIN
          BEGIN
            PERFORM public.reissue_connector_grant_tokens('${grantId}', repeat('a',64), repeat('b',64));
            RAISE EXCEPTION 'owner reissued another linked user grant';
          EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          IF NOT public.revoke_connector_grant('${grantId}', 'owner test') THEN
            RAISE EXCEPTION 'merchant owner could not revoke grant';
          END IF;
        END $$;
        ROLLBACK;
      `,
      ]);
    });

    it('production migration keeps inventory visible to owners and hidden from active staff', () => {
      psql([
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `
        BEGIN;
        INSERT INTO auth.users (id) VALUES ('eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee');
        INSERT INTO public.staff_members (id, merchant_id, user_id, role, status)
        VALUES ('ffffffff-ffff-4fff-afff-ffffffffffff', '${MERCHANT_A}',
          'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee', 'admin', 'active');
        SELECT set_config('request.jwt.claim.sub', '${OWNER}', true);
        SET LOCAL ROLE authenticated;
        DO $$ BEGIN
          IF (SELECT count(*) FROM public.variant_inventory
              WHERE merchant_id = '${MERCHANT_A}') = 0 THEN
            RAISE EXCEPTION 'owner inventory read denied';
          END IF;
        END $$;
        RESET ROLE;
        SELECT set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee', true);
        SET LOCAL ROLE authenticated;
        DO $$ BEGIN
          IF NOT public.has_merchant_access('${MERCHANT_A}') THEN
            RAISE EXCEPTION 'staff probe lacks merchant access';
          END IF;
          IF (SELECT count(*) FROM public.variant_inventory
              WHERE merchant_id = '${MERCHANT_A}') <> 0 THEN
            RAISE EXCEPTION 'production policy exposes inventory to staff';
          END IF;
        END $$;
        ROLLBACK;
      `,
      ]);
    });

    afterAll(async () => {
      await gateway?.close().catch(() => undefined);
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

    it('serves health and discovery under the stable base address', async () => {
      const health = await fetch(`${gateway?.baseUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        status: 'ok',
        gateway: 'r1-readonly',
        db: 'up',
      });
      expect(
        psqlQuery(
          "SELECT count(*) FROM public.connector_gateway_audit WHERE route = '/health'"
        )
      ).toBe('0');
      const discovery = await fetch(`${gateway?.baseUrl}/openapi.json`);
      expect(discovery.status).toBe(200);
      const document = (await discovery.json()) as {
        servers: Array<{ url: string }>;
        paths: Record<string, unknown>;
      };
      const docs = await fetch(`${gateway?.baseUrl}/docs`);
      expect(docs.status).toBe(200);
      expect(
        psqlQuery(
          "SELECT count(*) FROM public.connector_gateway_audit WHERE route IN ('/openapi.json', '/docs')"
        )
      ).toBe('0');
      expect(document.servers).toEqual([{ url: PUBLIC_BASE_URL }]);
      expect(
        Object.keys(document.paths).filter((path) =>
          path.startsWith('/v0/tools/')
        ).length
      ).toBe(4);
    });

    it('hides test grant management in production while serving merchant grants', async () => {
      const issued = await issueToken();
      const publicGateway = await startGatewayServer({
        host: '127.0.0.1',
        port: 0,
        databaseUrl: `postgres://connector_gateway:${GATEWAY_PASSWORD}@127.0.0.1:${pgPort}/postgres`,
        localGrantManagement: null,
        publicBaseUrl: PUBLIC_BASE_URL,
        rateLimitPerKey: 4,
        rateLimitPerIp: 1000,
        rateLimitWindowMs: 60_000,
        trustedProxies: ['127.0.0.1', '::1'],
      });
      try {
        const docs = await fetch(`${publicGateway.baseUrl}/docs`);
        expect(docs.status).toBe(200);
        expect(docs.headers.get('content-type')).toContain('text/html');
        expect(await docs.text()).toContain('Baci Merchant Connector');

        const issue = await fetch(`${publicGateway.baseUrl}/v0/issue-token`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${OWNER_SECRET}`,
          },
          body: JSON.stringify({ connection_id: 'public-should-not-issue' }),
        });
        expect(issue.status).toBe(404);

        const refresh = await fetch(`${publicGateway.baseUrl}/v0/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: issued.refreshToken }),
        });
        expect(refresh.status).toBe(404);

        const revoke = await fetch(`${publicGateway.baseUrl}/v0/revoke`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${OWNER_SECRET}`,
          },
          body: JSON.stringify({ grant_id: issued.grantId }),
        });
        expect(revoke.status).toBe(404);

        const read = await fetch(
          `${publicGateway.baseUrl}/v0/tools/orders.list`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${issued.token}`,
            },
            body: JSON.stringify({ limit: 5 }),
          }
        );
        expect(read.status).toBe(200);
      } finally {
        await publicGateway.close().catch(() => undefined);
      }
    });

    it('reads orders with separate payment/shipping status and durable audit', async () => {
      const { grantId, token } = await issueToken();
      const listed = await post('/v0/tools/orders.list', token, {});
      expect(listed.status).toBe(200);
      const orders = listed.json.orders as Array<{
        paymentStatus: string;
        shippingStatus: string;
      }>;
      expect(orders.length).toBeGreaterThan(0);
      for (const order of orders) {
        expect(typeof order.paymentStatus).toBe('string');
        expect(typeof order.shippingStatus).toBe('string');
      }

      const single = await post('/v0/tools/orders.get', token, {
        order_id: ORDER_A,
      });
      expect(single.status).toBe(200);
      const order = single.json.order as {
        paymentStatus: string;
        shippingStatus: string;
      };
      expect(typeof order.paymentStatus).toBe('string');
      expect(typeof order.shippingStatus).toBe('string');

      const audit = psqlQuery(
        `SELECT grant_id::text, route, status, latency_ms ` +
          `FROM public.connector_gateway_audit ` +
          `WHERE grant_id = '${grantId}'::uuid AND route = '/v0/tools/orders.list' ` +
          `ORDER BY occurred_at DESC LIMIT 1`
      );
      const [rowGrant, rowRoute, rowStatus, rowLatency] = audit.split('|');
      expect(rowGrant).toBe(grantId);
      expect(rowRoute).toBe('/v0/tools/orders.list');
      expect(rowStatus).toBe('200');
      expect(Number(rowLatency)).toBeGreaterThanOrEqual(0);

      const columns = psqlQuery(
        `SELECT column_name FROM information_schema.columns ` +
          `WHERE table_schema = 'public' ` +
          `AND table_name = 'connector_gateway_audit' ORDER BY 1`
      );
      expect(columns.split('\n')).toEqual([
        'grant_id',
        'id',
        'latency_ms',
        'occurred_at',
        'route',
        'status',
      ]);
    });

    it('limits per key without starving other keys', async () => {
      const hot = await issueToken();
      const cold = await issueToken();
      for (let call = 0; call < 4; call += 1) {
        const ok = await post('/v0/tools/orders.list', hot.token, {});
        expect(ok.status).toBe(200);
      }
      const limited = await post('/v0/tools/orders.list', hot.token, {});
      expect(limited.status).toBe(429);
      expect(limited.json.code).toBe('RATE_LIMITED');
      expect(limited.retryAfter).toMatch(/^\d+$/);

      const unaffected = await post('/v0/tools/orders.list', cold.token, {});
      expect(unaffected.status).toBe(200);
    });

    it('audits at most one rejection per client per window', async () => {
      const sampled = await issueToken();
      for (let call = 0; call < 4; call += 1) {
        const ok = await post('/v0/tools/orders.list', sampled.token, {});
        expect(ok.status).toBe(200);
      }
      const before = Number(
        psqlQuery(
          `SELECT count(*) FROM public.connector_gateway_audit WHERE status = 429`
        )
      );
      for (let call = 0; call < 3; call += 1) {
        const denied = await post('/v0/tools/orders.list', sampled.token, {});
        expect(denied.status).toBe(429);
      }
      const after = Number(
        psqlQuery(
          `SELECT count(*) FROM public.connector_gateway_audit WHERE status = 429`
        )
      );
      expect(after - before).toBe(1);
    });

    it('enforces merchant scope and coded denials', async () => {
      const { token } = await issueToken();
      const foreign = await post('/v0/tools/orders.list', token, {
        merchant_id: MERCHANT_B,
      });
      expect(foreign.status).toBe(403);
      expect(foreign.json.code).toBe('FORBIDDEN_SCOPE');

      const unknown = await post('/v0/tools/orders.list', 'mcn_nope', {});
      expect(unknown.status).toBe(401);
      expect(unknown.json.code).toBe('GRANT_REVOKED');

      const badBody = await post('/v0/tools/orders.list', token, {
        limit: 5000,
      });
      expect(badBody.status).toBe(400);
      expect(badBody.json.code).toBe('INVALID_REQUEST');

      const scopeDenied = await post('/v0/tools/inventory.levels', token, {});
      expect(scopeDenied.status).toBe(403);
      expect(scopeDenied.json.code).toBe('FORBIDDEN_SCOPE');
    });

    it('rejects out-of-range inventory limits', async () => {
      const { token } = await issueToken({
        scopes: ['orders:read', 'inventory:read', 'analytics:read'],
      });
      const badLimit = await post('/v0/tools/inventory.levels', token, {
        limit: 5000,
      });
      expect(badLimit.status).toBe(400);
      expect(badLimit.json.code).toBe('INVALID_REQUEST');
    });

    it('reads inventory levels narrowed to the requested branch', async () => {
      const { token } = await issueToken({
        scopes: ['orders:read', 'inventory:read', 'analytics:read'],
      });
      const all = await post('/v0/tools/inventory.levels', token, {});
      expect(all.status).toBe(200);
      const levels = all.json.levels as Array<{
        variantId: string;
        sku: string | null;
        branchId: string | null;
        available: number;
        reserved: number;
        sold: number;
        lowStock: boolean;
        outOfStock: boolean;
      }>;
      expect(levels).toHaveLength(3);
      const low = levels.find(
        (level) => level.branchId === BRANCH_A && level.sku === 'SKU-V1'
      );
      expect(low).toMatchObject({
        available: 2,
        reserved: 0,
        sold: 1,
        lowStock: true,
        outOfStock: false,
      });
      const healthy = levels.find((level) => level.sku === 'SKU-V2');
      expect(healthy).toMatchObject({ available: 6, lowStock: false });

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
      expect(foreign.json.code).toBe('FORBIDDEN_SCOPE');
    });

    it('keeps paid revenue separated by currency and retains branch scoping', async () => {
      psql([
        '-c',
        `UPDATE public.orders SET currency='USD', payment_status='paid' WHERE id='a0000000-0000-4000-a000-000000000002'`,
      ]);
      try {
        const { token } = await issueToken({ scopes: ['analytics:read'] });
        const result = await post('/v0/tools/analytics.summary', token, {});
        expect(result.status).toBe(200);
        expect(result.json.summary).toMatchObject({
          orders: {
            count: 2,
            paidCount: 2,
            paidRevenue: null,
            currency: null,
            paidRevenueByCurrency: [
              { currency: 'NGN', amount: 150 },
              { currency: 'USD', amount: 75.5 },
            ],
          },
        });
        const branch = await post('/v0/tools/analytics.summary', token, {
          branch_ids: [BRANCH_A],
        });
        expect(branch.json.summary).toMatchObject({
          orders: {
            paidRevenue: 150,
            currency: 'NGN',
            paidRevenueByCurrency: [{ currency: 'NGN', amount: 150 }],
          },
        });
      } finally {
        psql([
          '-c',
          `UPDATE public.orders SET currency='NGN', payment_status='unpaid' WHERE id='a0000000-0000-4000-a000-000000000002'`,
        ]);
      }
    });

    it('aggregates analytics without leaking excluded branches', async () => {
      const { token } = await issueToken({
        scopes: ['orders:read', 'inventory:read', 'analytics:read'],
      });
      const all = await post('/v0/tools/analytics.summary', token, {});
      expect(all.status).toBe(200);
      const summary = all.json.summary as {
        orders: {
          count: number;
          paidCount: number;
          paidRevenue: number;
          byShippingStatus: Array<{ status: string; count: number }>;
        };
        stock: {
          availableUnits: number;
          lowStockLevels: number;
          outOfStockLevels: number;
        };
      };
      // Foreign merchant rows (999.00 order, 2 foreign units) stay out.
      expect(summary.orders.count).toBe(2);
      expect(summary.orders.paidCount).toBe(1);
      expect(summary.orders.paidRevenue).toBe(150);
      expect(summary.orders.byShippingStatus).toEqual([
        { status: 'pending', count: 1 },
        { status: 'processing', count: 1 },
      ]);
      expect(summary.stock).toEqual({
        availableUnits: 9,
        lowStockLevels: 2,
        outOfStockLevels: 0,
      });

      const narrowed = await post('/v0/tools/analytics.summary', token, {
        branch_ids: [BRANCH_A],
      });
      expect(narrowed.status).toBe(200);
      const branchSummary = narrowed.json.summary as typeof summary;
      expect(branchSummary.orders.count).toBe(1);
      expect(branchSummary.orders.paidRevenue).toBe(150);
      expect(branchSummary.stock.availableUnits).toBe(8);
      expect(branchSummary.stock.lowStockLevels).toBe(1);

      const other = await post('/v0/tools/analytics.summary', token, {
        branch_ids: [BRANCH_B],
      });
      expect(other.status).toBe(200);
      const otherJson = other.json.summary as typeof summary;
      expect(otherJson.orders.count).toBe(1);
      expect(otherJson.orders.paidCount).toBe(0);
      expect(otherJson.orders.paidRevenue).toBe(0);

      const foreign = await post('/v0/tools/analytics.summary', token, {
        merchant_id: MERCHANT_B,
      });
      expect(foreign.status).toBe(403);
      expect(foreign.json.code).toBe('FORBIDDEN_SCOPE');
    });

    it('scopes branch-limited grants to their allowlist', async () => {
      const { token } = await issueToken({
        scopes: ['orders:read', 'inventory:read', 'analytics:read'],
        branch_ids: [BRANCH_A],
        merchant_wide: false,
      });
      const levels = await post('/v0/tools/inventory.levels', token, {});
      expect(levels.status).toBe(200);
      const rows = levels.json.levels as Array<{ branchId: string }>;
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.branchId === BRANCH_A)).toBe(true);

      const summary = await post('/v0/tools/analytics.summary', token, {});
      expect(summary.status).toBe(200);
      const scoped = summary.json.summary as {
        orders: { count: number };
        stock: { availableUnits: number };
      };
      expect(scoped.orders.count).toBe(1);
      expect(scoped.stock.availableUnits).toBe(8);

      const outside = await post('/v0/tools/inventory.levels', token, {
        branch_ids: [BRANCH_B],
      });
      expect(outside.status).toBe(403);
      expect(outside.json.code).toBe('BRANCH_NOT_ALLOWED');
    });

    it('rotates single-use credentials and enforces revocation', async () => {
      const { grantId, token, refreshToken } = await issueToken();
      const rotated = await post('/v0/refresh', null, {
        refresh_token: refreshToken,
      });
      expect(rotated.status).toBe(200);
      const nextToken = rotated.json.token as string;

      const stale = await post('/v0/tools/orders.list', token, {});
      expect(stale.status).toBe(401);
      const fresh = await post('/v0/tools/orders.list', nextToken, {});
      expect(fresh.status).toBe(200);

      const revoked = await post('/v0/revoke', OWNER_SECRET, {
        grant_id: grantId,
      });
      expect(revoked.status).toBe(200);
      const denied = await post('/v0/tools/orders.list', nextToken, {});
      expect(denied.status).toBe(401);
      expect(denied.json.code).toBe('GRANT_REVOKED');
    });

    it('reports database outages on refresh and revoke as 500', async () => {
      const deadPort = await freePort();
      const darkGateway = await startGatewayServer({
        host: '127.0.0.1',
        port: 0,
        databaseUrl: `postgres://connector_gateway:${GATEWAY_PASSWORD}@127.0.0.1:${deadPort}/postgres`,
        localGrantManagement: {
          ownerSecret: OWNER_SECRET,
          ownerUserId: OWNER,
          merchantId: MERCHANT_A,
        },
        publicBaseUrl: PUBLIC_BASE_URL,
        rateLimitPerKey: 4,
        rateLimitPerIp: 1000,
        rateLimitWindowMs: 60_000,
        trustedProxies: ['127.0.0.1', '::1'],
      });
      try {
        const refresh = await fetch(`${darkGateway.baseUrl}/v0/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: 'mcn_refresh_dead' }),
        });
        expect(refresh.status).toBe(500);
        expect(await refresh.json()).toMatchObject({
          code: 'UNKNOWN_OUTCOME',
        });

        const revoke = await fetch(`${darkGateway.baseUrl}/v0/revoke`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${OWNER_SECRET}`,
          },
          body: JSON.stringify({
            grant_id: '00000000-0000-4000-8000-000000000000',
          }),
        });
        expect(revoke.status).toBe(500);
        expect(await revoke.json()).toMatchObject({
          code: 'UNKNOWN_OUTCOME',
        });
      } finally {
        await darkGateway.close().catch(() => undefined);
      }
    });
  }
);
